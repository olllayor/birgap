import { canonicalDirectPair } from './thread.util';

describe('canonicalDirectPair', () => {
  it('sorts direct thread participants consistently', () => {
    expect(canonicalDirectPair('user-b', 'user-a')).toEqual(['user-a', 'user-b']);
    expect(canonicalDirectPair('user-a', 'user-b')).toEqual(['user-a', 'user-b']);
  });
});
