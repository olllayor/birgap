export function canonicalDirectPair(userIdA: string, userIdB: string) {
  if (userIdA === userIdB) {
    return [userIdA, userIdB] as const;
  }
  return userIdA < userIdB ? ([userIdA, userIdB] as const) : ([userIdB, userIdA] as const);
}
