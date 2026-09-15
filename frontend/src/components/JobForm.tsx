import { useState, type FormEvent } from 'react';

interface Props {
  onCreate: (input: { title: string; type: string }) => Promise<boolean>;
  creating: boolean;
}

/** Suggestions only — the API accepts any non-empty type string. */
const COMMON_TYPES = ['email', 'report', 'export', 'cleanup', 'import', 'notification'];

export function JobForm({ onCreate, creating }: Props) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    // Cheap feedback before spending a round-trip. The server validates the
    // same rules regardless — this only saves the user a wait.
    const trimmedTitle = title.trim();
    const trimmedType = type.trim();

    if (!trimmedTitle || !trimmedType) {
      setValidationError('Both a title and a type are required.');
      return;
    }

    setValidationError(null);
    const created = await onCreate({ title: trimmedTitle, type: trimmedType });

    if (created) {
      setTitle('');
      setType('');
    }
  }

  return (
    <form className="job-form" onSubmit={handleSubmit}>
      <div className="job-form__fields">
        <label className="field">
          <span className="field__label">Title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Send welcome emails"
            maxLength={200}
            disabled={creating}
          />
        </label>

        <label className="field">
          <span className="field__label">Type</span>
          <input
            value={type}
            onChange={(event) => setType(event.target.value)}
            placeholder="email"
            list="job-types"
            maxLength={100}
            disabled={creating}
          />
          <datalist id="job-types">
            {COMMON_TYPES.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </label>

        <button type="submit" className="button button--primary" disabled={creating}>
          {creating ? 'Creating…' : 'Create job'}
        </button>
      </div>

      <p className="job-form__hint">New jobs always start as <strong>pending</strong>.</p>

      {validationError && (
        <p className="job-form__error" role="alert">
          {validationError}
        </p>
      )}
    </form>
  );
}
