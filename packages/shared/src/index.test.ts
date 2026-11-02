import { describe, expect, it } from 'vitest';
import * as shared from './index.js';

describe('@dinepos/shared entry', () => {
  it('loads as an ES module', () => {
    expect(shared).toBeTypeOf('object');
  });
});
