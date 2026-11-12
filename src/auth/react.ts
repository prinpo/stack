export * from "better-auth/react";
export { organizationBySlug } from "./client";

import { useCallback, useEffect, useRef, useState } from "react";

interface OrganizationClient {
  organization: {
    getFullOrganization: (input: {
      query: { organizationSlug: string };
    }) => Promise<{ data: unknown; error: unknown }>;
  };
}

/** URL-scoped lookup through native Better Auth; does not select a session active organization. */
export function useOrganizationBySlug<Client extends OrganizationClient>(
  client: Client,
  slug: string,
) {
  type Result = Awaited<ReturnType<Client["organization"]["getFullOrganization"]>>;
  const [data, setData] = useState<Result["data"] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [isPending, setPending] = useState(true);
  const revision = useRef(0);
  const refetch = useCallback(async () => {
    const current = ++revision.current;
    setPending(true);
    try {
      const result = await client.organization.getFullOrganization({
        query: { organizationSlug: slug },
      });
      if (current === revision.current) {
        setData(result.data as Result["data"]);
        setError(result.error);
      }
    } catch (cause) {
      if (current === revision.current) {
        setError(cause);
        setData(null);
      }
    } finally {
      if (current === revision.current) setPending(false);
    }
  }, [client, slug]);
  useEffect(() => {
    setData(null);
    void refetch();
    return () => {
      revision.current++;
    };
  }, [refetch]);
  return { data, error, isPending, refetch };
}
