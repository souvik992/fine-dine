import { describe, expect, it } from 'vitest';
import * as printing from './index.js';

describe('@dinepos/printing entry', () => {
  it('loads as an ES module', () => {
    expect(printing).toBeTypeOf('object');
  });
});
