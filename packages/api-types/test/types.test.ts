import { describe, expectTypeOf, it } from 'vitest';
import type { ApiResponse, Schema } from '../src/index.js';

describe('helper types', () => {
  it('give the success answer of an operation and the named schemas', () => {
    expectTypeOf<ApiResponse<'/api/{uni}/raids'>>().toEqualTypeOf<Schema<'Raids'>>();
    expectTypeOf<ApiResponse<'/api/{uni}/raids'>['missiles'][number]['created_at']>().toEqualTypeOf<number>();
    expectTypeOf<Schema<'Plan'>['fleets'][number]['g']>().toEqualTypeOf<number | null>();
    expectTypeOf<ApiResponse<'/api/{uni}/comments'>>().toEqualTypeOf<Schema<'Comment'>[]>();
  });
});
