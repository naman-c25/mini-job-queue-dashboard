import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { JobStatus } from '../job-status.js';

@Entity('jobs')
export class Job {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 100 })
  type: string;

  /**
   * Stored as a native Postgres enum. The database — not just the application —
   * refuses any value outside the four allowed statuses, so a bad write from
   * any client (psql included) is rejected at the last line of defence.
   */
  @Index()
  @Column({ type: 'enum', enum: JobStatus, enumName: 'job_status', default: JobStatus.PENDING })
  status: JobStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
