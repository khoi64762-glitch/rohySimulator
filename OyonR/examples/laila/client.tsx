// LAILA client (Vite + React SPA) — the entire client-side integration.
// Drop <OyonCapture> into a lesson/attempt view. `session_id` is required;
// every other key (user_id, course_id, …) rides along on each window so you
// can join Oyon's analytics against LAILA's own tables.
//
// This is a client-only surface: the Oyon runtime touches the camera and
// <canvas>, so keep it out of any SSR path (LAILA's client is a Vite SPA, so
// there is none — nothing extra to do).
import { OyonCapture } from 'oyon/react/capture';

export function LessonAffectCapture({ attempt, user, course, token }: {
  attempt: { id: string };
  user: { id: string };
  course: { id: string };
  token: string;
}) {
  return (
    <OyonCapture
      apiBaseUrl="/api/oyon"
      getContext={() => ({ session_id: attempt.id, user_id: user.id, course_id: course.id })}
      getToken={() => token}
    />
  );
}

// Dashboards (affect / gaze / sequence tabs) with zero React wiring — one tag,
// framework-agnostic. Point it at the same backend; it reads what capture wrote.
//
//   <oyon-app chrome="capture-analytics" api-base-url="/api/oyon" />
//
// (Load the element bundle once: `import 'oyon/app-element';`.)
