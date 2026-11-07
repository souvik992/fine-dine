import { describe, expect, it } from 'vitest';
import { directionsUrl, mapView, project, TILE } from './map-view.js';

const store = { lat: 22.5726, lng: 88.3639 };
const customer = { lat: 22.5535, lng: 88.3517 };

describe('delivery map', () => {
  it('projects to Web Mercator world pixels', () => {
    expect(project({ lat: 0, lng: 0 }, 0)).toEqual({ x: TILE / 2, y: TILE / 2 });
    expect(project({ lat: 0, lng: 180 }, 1).x).toBe(TILE * 2);
  });

  it('shows one point close up, in the middle of the box', () => {
    const v = mapView([customer], 600, 400);
    expect(v.zoom).toBe(17);
    expect(v.pins).toEqual([{ x: 300, y: 200 }]);
  });

  it('zooms out until the store and the customer both fit, inside the margin', () => {
    const v = mapView([customer, store], 600, 400);
    expect(v.zoom).toBeLessThan(17);
    for (const p of v.pins) {
      expect(p.x).toBeGreaterThanOrEqual(48);
      expect(p.x).toBeLessThanOrEqual(552);
      expect(p.y).toBeGreaterThanOrEqual(48);
      expect(p.y).toBeLessThanOrEqual(352);
    }
  });

  it('covers the whole box with tiles from the OpenStreetMap tile server', () => {
    const v = mapView([customer, store], 600, 400);
    expect(Math.min(...v.tiles.map((t) => t.left))).toBeLessThanOrEqual(0);
    expect(Math.min(...v.tiles.map((t) => t.top))).toBeLessThanOrEqual(0);
    expect(Math.max(...v.tiles.map((t) => t.left + TILE))).toBeGreaterThanOrEqual(600);
    expect(Math.max(...v.tiles.map((t) => t.top + TILE))).toBeGreaterThanOrEqual(400);
    expect(v.tiles.every((t) => t.src.startsWith(`https://tile.openstreetmap.org/${v.zoom}/`))).toBe(true);
  });

  it('gives directions from the store when its location is set', () => {
    expect(directionsUrl(customer, store)).toBe('https://www.google.com/maps/dir/?api=1&origin=22.5726,88.3639&destination=22.5535,88.3517&travelmode=driving');
    expect(directionsUrl(customer, null)).not.toContain('origin');
  });
});
