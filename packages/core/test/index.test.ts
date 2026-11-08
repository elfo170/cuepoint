import { describe, expect, it } from 'vitest';
import { CUEPOINT_SCHEMA_VERSION } from '../src/index';

describe('core', () => {
  it('expõe a versão do schema', () => {
    expect(CUEPOINT_SCHEMA_VERSION).toBe(1);
  });
});
