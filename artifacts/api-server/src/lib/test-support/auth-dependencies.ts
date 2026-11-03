// Bundler aliases in the guard test runner only. Never imported by the app.
export const state = {
  auth: { isAuthenticated: true, userId: "fixture-user", sessionId: "fixture-session" },
  member: { email: "fixture@example.invalid", role: "ADMIN", active: true } as {
    email: string; role: string; active: boolean;
  } | undefined,
  providerError: undefined as unknown,
  databaseError: undefined as unknown,
};
export const getAuth = () => state.auth;
export const clerkClient = {
  users: {
    async getUser() {
      if (state.providerError) throw state.providerError;
      return { primaryEmailAddressId: "fixture-email", emailAddresses: [
        { id: "fixture-email", emailAddress: "fixture@example.invalid" },
      ] };
    },
  },
};
export const zero3MembersTable = { email: "email" };
const database = {
  select: () => ({
    from: () => ({
      where: () => ({ limit: async () => state.member ? [state.member] : [] }),
    }),
  }),
};
export async function withCurrentDatabaseClient(
  callback: (db: typeof database) => Promise<unknown>,
  connected: () => void,
) {
  if (state.databaseError) throw state.databaseError;
  connected();
  return callback(database);
}
