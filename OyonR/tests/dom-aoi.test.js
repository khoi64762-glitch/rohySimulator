import assert from 'node:assert/strict';
import {
  domRectToGazeAoi,
  elementToGazeAoi,
} from '../src/gaze/domAoi.js';

const MAXIMIZED = {
  innerWidth: 1000,
  innerHeight: 800,
  screenX: 0,
  screenY: 0,
  outerWidth: 1000,
  outerHeight: 800,
  screenWidth: 1000,
  screenHeight: 800,
};

{
  const aoi = domRectToGazeAoi(
    { left: 372, top: 272, width: 256, height: 256 },
    MAXIMIZED,
    {
      id: 'agent_face',
      region: { left: 0.19, top: 0.08, width: 0.62, height: 0.7 },
      minSize: 0.12,
    },
  );
  assert.equal(aoi.id, 'agent_face');
  assert.ok(Math.abs(aoi.x + aoi.width / 2) < 0.01);
  assert.ok(aoi.width >= 0.12);
  assert.ok(aoi.height >= 0.12);
}

{
  const environment = {
    innerWidth: 1000,
    innerHeight: 800,
    screenX: 200,
    screenY: 100,
    outerWidth: 1016,
    outerHeight: 900,
    screenWidth: 2560,
    screenHeight: 1440,
  };
  const aoi = domRectToGazeAoi(
    { left: 0, top: 0, width: 600, height: 600 },
    environment,
    {
      id: 'patient_face',
      region: { left: 0.19, top: 0.08, width: 0.62, height: 0.7 },
    },
  );
  assert.ok(Math.abs(aoi.x - ((200 + 8 + 600 * 0.19) / 2560 - 0.5)) < 1e-9);
  assert.ok(Math.abs(aoi.y - ((100 + 100 + 600 * 0.08) / 1440 - 0.5)) < 1e-9);
}

{
  const aoi = domRectToGazeAoi(
    { left: 980, top: 780, width: 80, height: 80 },
    MAXIMIZED,
    { id: 'edge', minSize: 0.12 },
  );
  assert.ok(aoi.x >= -0.5 && aoi.x + aoi.width <= 0.5 + 1e-9);
  assert.ok(aoi.y >= -0.5 && aoi.y + aoi.height <= 0.5 + 1e-9);
}

assert.equal(
  domRectToGazeAoi({ left: 0, top: 0, width: 0, height: 10 }, MAXIMIZED),
  null,
);
assert.equal(
  domRectToGazeAoi({ left: 1200, top: 0, width: 10, height: 10 }, MAXIMIZED),
  null,
);
assert.equal(elementToGazeAoi(null), null);

{
  const fakeWindow = {
    innerWidth: 1000,
    innerHeight: 800,
    screenX: 0,
    screenY: 0,
    outerWidth: 1000,
    outerHeight: 800,
    screen: { width: 1000, height: 800 },
  };
  const element = {
    ownerDocument: { defaultView: fakeWindow },
    getBoundingClientRect: () => ({ left: 400, top: 300, width: 200, height: 200 }),
  };
  const aoi = elementToGazeAoi(element, { id: 'chat_panel' });
  assert.equal(aoi.id, 'chat_panel');
  assert.ok(Math.abs(aoi.x + aoi.width / 2) < 1e-9);
  assert.ok(Math.abs(aoi.y + aoi.height / 2) < 1e-9);
}

console.log('dom-aoi.test.js passed');
