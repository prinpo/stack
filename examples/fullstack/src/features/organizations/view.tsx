import type { User } from "@prinpo/stack/auth";
import type { Member } from "@prinpo/stack/auth/plugins/organization";

import { useOrganizationBySlug } from "@prinpo/stack/auth/react";
import { useState } from "react";

import { authClient } from "../../auth-client";

export function OrganizationsView() {
  const { data: session } = authClient.useSession();
  const { data: organizations, refetch } = authClient.useListOrganizations();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [message, setMessage] = useState("");
  if (!session)
    return (
      <section>
        <h2>Organizations</h2>
        <a href="/auth">Sign in first</a>
      </section>
    );
  return (
    <section>
      <h2>Organizations</h2>
      <ul>
        {organizations?.map((org) => (
          <li key={org.id}>
            <a href={`/organizations/${encodeURIComponent(org.slug)}`}>{org.name}</a>
          </li>
        ))}
      </ul>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const result = await authClient.organization.create({ name, slug });
          setMessage(result.error?.message ?? "Organization created");
          await refetch();
        }}
      >
        <label>
          Name
          <input required value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Slug
          <input required value={slug} onChange={(event) => setSlug(event.target.value)} />
        </label>
        <button>Create organization</button>
      </form>
      <p role="status">{message}</p>
    </section>
  );
}

export function OrganizationView({ slug }: { slug: string }) {
  const { data: organization, isPending, error, refetch } = useOrganizationBySlug(authClient, slug);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  if (isPending) return <p>Loading organization…</p>;
  if (error || !organization)
    return (
      <section>
        <h2>Organization not found</h2>
      </section>
    );
  return (
    <section>
      <h2>{organization.name}</h2>
      <p>URL-scoped organization: {slug}</p>
      <ul>
        {organization.members.map((member: Member & { user: User }) => (
          <li key={member.id}>
            {member.user.email} — {member.role}
          </li>
        ))}
      </ul>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const result = await authClient.organization.inviteMember({
            email,
            role: "member",
            organizationId: organization.id,
          });
          setMessage(result.error?.message ?? "Invitation created; check development consoles.");
          await refetch();
        }}
      >
        <label>
          Invite email
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <button>Invite member</button>
      </form>
      <p role="status">{message}</p>
    </section>
  );
}

export function InvitationView() {
  const id = new URLSearchParams(window.location.search).get("id");
  const { data: session } = authClient.useSession();
  const [message, setMessage] = useState("");
  return (
    <section>
      <h2>Accept invitation</h2>
      {!session ? (
        <a href="/auth">Sign in with the invited email first</a>
      ) : (
        <button
          disabled={!id}
          onClick={async () => {
            const result = await authClient.organization.acceptInvitation({ invitationId: id! });
            setMessage(result.error?.message ?? "Invitation accepted");
          }}
        >
          Accept invitation
        </button>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
