// Client mirror of the shared default-course helpers. The canonical module lives
// in server/shared/ (the Docker runtime stage ships server/ but not src/); the
// client re-exports it so both sides agree on the seeded name and on when the
// name should be rendered through the translated `default_course_name` catalogue
// entry instead of verbatim.
export * from '../../server/shared/defaultCourse.js';
