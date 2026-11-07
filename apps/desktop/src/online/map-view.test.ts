import { describe, expect, it } from 'vitest';
import { directionsUrl, mapView, parsePlaces, placeSearchUrl, pointAt, project, pxPerKm, TILE, unproject, viewAt } from './map-view.js';

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

  it('turns a click on the map back into the point under it', () => {
    expect(unproject(project(store, 15).x, project(store, 15).y, 15)).toEqual(store);
    expect(pointAt(store, 15, 600, 400, 300, 200)).toEqual(store);
    const v = viewAt(store, 15, 600, 400, [customer]);
    const back = pointAt(store, 15, 600, 400, v.pins[0]!.x, v.pins[0]!.y);
    expect(back.lat).toBeCloseTo(customer.lat, 4);
    expect(back.lng).toBeCloseTo(customer.lng, 4);
  });

  it('sizes band rings in pixels per kilometre', () => {
    expect(pxPerKm(0, 0)).toBeCloseTo(256 / 40_075, 6);
    expect(pxPerKm(60, 10)).toBeCloseTo(2 * pxPerKm(0, 10), 6);
  });

  it('searches places in India by name as you type and reads the matches', () => {
    expect(placeSearchUrl(' marathah ')).toBe('https://photon.komoot.io/api/?q=marathah&limit=6&lang=en&bbox=68,6,98,38');
    const pt = (lng: number, lat: number) => ({ type: 'Point', coordinates: [lng, lat] });
    const body = {
      features: [
        { properties: { name: 'Marathahalli', county: 'Bangalore East', state: 'Karnataka', countrycode: 'IN' }, geometry: pt(77.6984163, 12.9552572) },
        { properties: { name: 'Marathahalli', county: 'Bangalore East', state: 'Karnataka', countrycode: 'IN' }, geometry: pt(77.7, 12.9) }, // same name: once
        { properties: { name: 'Kathmandu', countrycode: 'NP' }, geometry: pt(85.3, 27.7) }, // not India
        { properties: { name: 'Broken', countrycode: 'IN' } },
        null,
      ],
    };
    expect(parsePlaces(body)).toEqual([{ name: 'Marathahalli, Bangalore East, Karnataka', lat: 12.955257, lng: 77.698416 }]);
    expect(parsePlaces({ message: 'busy' })).toEqual([]);
  });
});
