// The tenant default course ("Basic course").
//
// Identity is `cohorts.is_default = 1` (migration 0044) — NEVER the name. The
// seeded name is the English literal below and is display-only: an admin may
// rename or localise it, and nothing on the server keys off it. The client
// translates the name only while it is still the untouched seeded literal, so
// a custom name is always shown exactly as typed.
//
// Lives under server/shared/ (not src/) for the same Docker-image reason as
// languages.js: the runtime stage ships server/ but not src/.

export const DEFAULT_COURSE_NAME = 'Basic course';

/**
 * Whether a course row's name should be shown as the translated default-course
 * label rather than verbatim.
 * @param {{ name?: string|null, is_default?: number|boolean|null }} course
 * @returns {boolean} true only for the DEFAULT course whose name is still the
 *   seeded English literal.
 */
export function usesSeededDefaultCourseName(course) {
    return Boolean(course?.is_default) && course?.name === DEFAULT_COURSE_NAME;
}
