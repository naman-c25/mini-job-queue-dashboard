import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateJobDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'title must not be empty' })
  @MaxLength(200)
  title: string;

  /**
   * Free-form label for the kind of work (e.g. "email", "report-export").
   * The spec does not enumerate job types, so the API does not invent a closed
   * set — it only constrains shape. See README → Assumptions.
   */
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'type must not be empty' })
  @MaxLength(100)
  type: string;
}
