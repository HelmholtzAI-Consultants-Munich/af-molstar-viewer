import type { WorkspaceProject } from '../../domain/project';

interface JobListProps {
  project: WorkspaceProject;
}

export function JobList(props: JobListProps) {
  return (
    <section className="panel project-section-panel">
      <h2>Jobs</h2>
      <ul className="compact-list">
        {props.project.jobs.length === 0 ? (
          <li>No jobs running</li>
        ) : (
          props.project.jobs.map((job) => (
            <li key={job.job_id}>
              <strong>{job.job_type}</strong>
              <span>{job.status}</span>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
