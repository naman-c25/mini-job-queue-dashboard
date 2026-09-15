import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { JobStatus } from '../job-status.js';

/**
 * Append-only audit trail of every status change (see README → Bonus).
 *
 * Deliberately *not* a foreign key onto `jobs`: an audit row has to outlive the
 * job it describes, otherwise deleting a job would erase the evidence of what
 * it did. The trade-off is that `jobId` can reference a row that no longer
 * exists, which is the correct semantics for an audit log.
 */
@Entity('job_status_transitions')
export class JobStatusTransition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  jobId: string;

  /** `null` on creation, when the job comes into existence as `pending`. */
  @Column({ type: 'enum', enum: JobStatus, enumName: 'job_status', nullable: true })
  fromStatus: JobStatus | null;

  @Column({ type: 'enum', enum: JobStatus, enumName: 'job_status' })
  toStatus: JobStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
