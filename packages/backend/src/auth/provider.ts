/**
 * Authentication provider boundary (design Decision 7).
 *
 * Local credentials are the only implementation in this change. The interface exists so
 * that adding OIDC later is an adapter plus configuration, touching neither session
 * handling, role resolution, nor write attribution — the three things a migration would
 * otherwise have to disturb.
 */

export type AuthenticatedIdentity = {
  /** Stable identifier within the provider. For local accounts this is the user id. */
  externalId: string;
  email: string;
  displayName: string;
};

export type AuthProvider = {
  /** Provider discriminator, persisted on the user row. */
  readonly name: 'local' | 'oidc';
  /**
   * Resolves credentials to an identity, or null when they do not authenticate.
   * Implementations MUST NOT distinguish "no such account" from "wrong secret".
   */
  authenticate(input: Record<string, unknown>): Promise<AuthenticatedIdentity | null>;
};

export class AuthProviderRegistry {
  readonly #providers = new Map<string, AuthProvider>();

  register(provider: AuthProvider): this {
    this.#providers.set(provider.name, provider);
    return this;
  }

  get(name: string): AuthProvider | undefined {
    return this.#providers.get(name);
  }

  get names(): string[] {
    return [...this.#providers.keys()];
  }
}
