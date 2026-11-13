import { describe, expect, it } from 'vitest';
import { createRecommender, RecometError } from '../src/index.js';
import { expectRecometError, makeRecommender, recommendRaw } from './helpers.js';

describe('hostile proxy boundary', () => {
  it('returns a safe INTERNAL_ERROR for a revoked request proxy', () => {
    const revocable = Proxy.revocable({ items: [] }, {});
    revocable.revoke();

    const error = expectRecometError(
      () => recommendRaw(makeRecommender(), revocable.proxy),
      'INTERNAL_ERROR',
    );
    expect(error.message).toBe('An internal error occurred.');
  });

  it('returns a safe INTERNAL_ERROR for a revoked item proxy', () => {
    const revocable = Proxy.revocable({ id: 'a' }, {});
    revocable.revoke();

    expectRecometError(
      () => recommendRaw(makeRecommender(), { items: [revocable.proxy] }),
      'INTERNAL_ERROR',
    );
  });

  it('returns a safe INTERNAL_ERROR when a proxy trap throws during inspection', () => {
    const request = new Proxy(
      { items: [] },
      {
        ownKeys() {
          throw new Error('hostile-owned-key-detail');
        },
      },
    );

    const error = expectRecometError(
      () => recommendRaw(makeRecommender(), request),
      'INTERNAL_ERROR',
    );
    expect(error.message).not.toContain('hostile-owned-key-detail');
  });

  it('returns a safe INTERNAL_ERROR when configuration inspection fails', () => {
    const config = new Proxy(
      { strategy: 'baseline' },
      {
        getPrototypeOf() {
          throw new Error('hostile-config-detail');
        },
      },
    );

    const error = expectRecometError(() => createRecommender(config as never), 'INTERNAL_ERROR');
    expect(error.message).not.toContain('hostile-config-detail');
  });

  it('does not invoke the proxy get trap when descriptors are benign', () => {
    let getInvoked = false;
    const request = new Proxy(
      { items: [{ id: 'a' }] },
      {
        get() {
          getInvoked = true;
          throw new Error('unexpected get');
        },
      },
    );

    const result = recommendRaw(makeRecommender(), request);
    expect(result.recommendations.map((entry) => entry.itemId)).toEqual(['a']);
    expect(getInvoked).toBe(false);
  });

  it('does not invoke item or attribute get traps when descriptors are benign', () => {
    let getInvoked = false;
    const attributes = new Proxy(
      { title: 'value' },
      {
        get() {
          getInvoked = true;
          throw new Error('unexpected get');
        },
      },
    );
    const item = new Proxy(
      { id: 'a', attributes },
      {
        get() {
          getInvoked = true;
          throw new Error('unexpected get');
        },
      },
    );

    const result = recommendRaw(makeRecommender(), { items: [item] });
    expect(result.recommendations[0]?.itemId).toBe('a');
    expect(getInvoked).toBe(false);
  });

  it('returns a safe INTERNAL_ERROR when a descriptor trap throws', () => {
    const item = new Proxy(
      { id: 'a' },
      {
        getOwnPropertyDescriptor() {
          throw new Error('hostile-descriptor-detail');
        },
      },
    );

    const error = expectRecometError(
      () => recommendRaw(makeRecommender(), { items: [item] }),
      'INTERNAL_ERROR',
    );
    expect(error.message).not.toContain('hostile-descriptor-detail');
  });

  it('documents that proxy traps can execute during inspection', () => {
    let trapRuns = 0;
    const request = new Proxy(
      { items: [] },
      {
        getPrototypeOf(target) {
          trapRuns += 1;
          return Reflect.getPrototypeOf(target);
        },
      },
    );

    const result = recommendRaw(makeRecommender(), request);
    expect(result.recommendations).toEqual([]);
    expect(trapRuns).toBeGreaterThan(0);
  });

  it('never throws a non-RecometError to the recommendation caller', () => {
    const hostileValues: unknown[] = [
      new Proxy(
        {},
        {
          getPrototypeOf: () => {
            throw new Error('x');
          },
        },
      ),
      new Proxy(
        {},
        {
          ownKeys: () => {
            throw new Error('x');
          },
        },
      ),
      {
        items: new Proxy([], {
          ownKeys: () => {
            throw new Error('x');
          },
        }),
      },
    ];

    for (const value of hostileValues) {
      try {
        recommendRaw(makeRecommender(), value);
        throw new Error('expected a throw');
      } catch (error) {
        expect(error).toBeInstanceOf(RecometError);
        expect((error as RecometError).code).toBe('INTERNAL_ERROR');
      }
    }
  });
});
