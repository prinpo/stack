export * from "better-auth/client";

/** A slug lookup delegates to the native authorized endpoint; no parallel organization cache. */
export function organizationBySlug<
  Client extends {
    organization: {
      getFullOrganization: (input: { query: { organizationSlug: string } }) => unknown;
    };
  },
>(client: Client, slug: string): ReturnType<Client["organization"]["getFullOrganization"]> {
  return client.organization.getFullOrganization({
    query: { organizationSlug: slug },
  }) as ReturnType<Client["organization"]["getFullOrganization"]>;
}
