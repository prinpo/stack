export * from "better-auth/react";
export { organizationBySlug } from "./client";

import { useCallback, useEffect, useRef, useState } from "react";

interface OrganizationClient {
  useSession: () => {
    data: { user: { id: string }; session: { id: string } } | null;
    isPending: boolean;
  };
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
  const session = client.useSession();
  const destination = session.data
    ? `${slug}\0${session.data.user.id}\0${session.data.session.id}`
    : null;
  const [resolved, setResolved] = useState<string | null>(null);
  const [data, setData] = useState<Result["data"] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [isPending, setPending] = useState(true);
  const revision = useRef(0);
  const refetch = useCallback(async () => {
    const current = ++revision.current;
    if (!destination || session.isPending) {
      setData(null);
      setError(null);
      setResolved(null);
      setPending(session.isPending);
      return;
    }
    setPending(true);
    try {
      const result = await client.organization.getFullOrganization({
        query: { organizationSlug: slug },
      });
      if (current === revision.current) {
        setResolved(destination);
        setData(result.data as Result["data"]);
        setError(result.error);
      }
    } catch (cause) {
      if (current === revision.current) {
        setResolved(destination);
        setError(cause);
        setData(null);
      }
    } finally {
      if (current === revision.current) setPending(false);
    }
  }, [client, slug, destination, session.isPending]);
  useEffect(() => {
    setData(null);
    void refetch();
    return () => {
      revision.current++;
    };
  }, [refetch]);
  const visible = !!destination && resolved === destination && !session.isPending;
  return {
    data: visible ? data : null,
    error: visible ? error : null,
    isPending: session.isPending || (!!destination && (isPending || resolved !== destination)),
    refetch,
  };
}
