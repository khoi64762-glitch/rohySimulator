const DEFAULT_REGION = Object.freeze({
  left: 0,
  top: 0,
  width: 1,
  height: 1,
});

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function normalizedRegion(region) {
  const candidate = region ?? DEFAULT_REGION;
  if (
    !finite(candidate.left)
    || !finite(candidate.top)
    || !finite(candidate.width)
    || !finite(candidate.height)
    || candidate.width <= 0
    || candidate.height <= 0
  ) {
    return DEFAULT_REGION;
  }
  return candidate;
}

function clampMinSize(value) {
  if (!finite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Convert a visible DOM rectangle into Oyon's physical-screen gaze
 * coordinates (`[-0.5, 0.5]`, origin at screen centre).
 *
 * The optional `region` selects a semantic sub-region of the DOM rect, using
 * fractions of that rect. For example, a tutor/avatar host can identify the
 * face inside a larger stage without duplicating screen/chrome geometry math.
 *
 * This helper is deliberately DOM-free: callers can pass a DOMRect-like
 * object and window/screen geometry, while tests and non-browser hosts can
 * provide plain objects. Use elementToGazeAoi() for the browser convenience
 * wrapper.
 */
export function domRectToGazeAoi(rect, environment, options = {}) {
  if (
    !rect
    || !finite(rect.left)
    || !finite(rect.top)
    || !finite(rect.width)
    || !finite(rect.height)
    || rect.width <= 0
    || rect.height <= 0
  ) {
    return null;
  }
  if (
    !environment
    || !finite(environment.innerWidth)
    || !finite(environment.innerHeight)
    || environment.innerWidth <= 0
    || environment.innerHeight <= 0
  ) {
    return null;
  }

  // A fully off-viewport element is not a semantic target the learner can
  // currently look at.
  if (rect.left + rect.width <= 0 || rect.top + rect.height <= 0) return null;
  if (rect.left >= environment.innerWidth || rect.top >= environment.innerHeight) return null;

  const id = typeof options.id === 'string' && options.id.trim()
    ? options.id.trim()
    : 'target';
  const region = normalizedRegion(options.region);
  const target = {
    left: rect.left + rect.width * region.left,
    top: rect.top + rect.height * region.top,
    width: rect.width * region.width,
    height: rect.height * region.height,
  };

  const screenAvailable =
    finite(environment.screenWidth)
    && environment.screenWidth >= environment.innerWidth
    && finite(environment.screenHeight)
    && environment.screenHeight >= environment.innerHeight
    && finite(environment.screenX)
    && finite(environment.screenY);

  let x;
  let y;
  let width;
  let height;
  if (screenAvailable) {
    const chromeX = finite(environment.outerWidth)
      ? Math.max(0, (environment.outerWidth - environment.innerWidth) / 2)
      : 0;
    const chromeY = finite(environment.outerHeight)
      ? Math.max(0, environment.outerHeight - environment.innerHeight)
      : 0;
    x = (environment.screenX + chromeX + target.left) / environment.screenWidth - 0.5;
    y = (environment.screenY + chromeY + target.top) / environment.screenHeight - 0.5;
    width = target.width / environment.screenWidth;
    height = target.height / environment.screenHeight;
  } else {
    // Correct for the common maximized-browser case, and a deterministic
    // fallback when browser privacy controls hide physical screen geometry.
    x = target.left / environment.innerWidth - 0.5;
    y = target.top / environment.innerHeight - 0.5;
    width = target.width / environment.innerWidth;
    height = target.height / environment.innerHeight;
  }

  const minSize = clampMinSize(options.minSize ?? 0);
  if (width < minSize) {
    x -= (minSize - width) / 2;
    width = minSize;
  }
  if (height < minSize) {
    y -= (minSize - height) / 2;
    height = minSize;
  }

  width = Math.min(width, 1);
  height = Math.min(height, 1);
  x = Math.max(-0.5, Math.min(0.5 - width, x));
  y = Math.max(-0.5, Math.min(0.5 - height, y));

  return { id, x, y, width, height };
}

/**
 * Browser convenience wrapper around domRectToGazeAoi().
 */
export function elementToGazeAoi(element, options = {}) {
  if (!element || typeof element.getBoundingClientRect !== 'function') return null;
  const view = element.ownerDocument?.defaultView;
  if (!view) return null;
  const screen = view.screen;
  return domRectToGazeAoi(
    element.getBoundingClientRect(),
    {
      innerWidth: view.innerWidth,
      innerHeight: view.innerHeight,
      screenX: view.screenX,
      screenY: view.screenY,
      outerWidth: view.outerWidth,
      outerHeight: view.outerHeight,
      screenWidth: screen?.width,
      screenHeight: screen?.height,
    },
    options,
  );
}
