import { betterAuth, createAuthHelpers } from "../src/auth";
import { organization } from "../src/auth/organization";
import { Elysia } from "../src/server";

const auth = betterAuth({
  user: { additionalFields: { plan: { type: "string", required: true } } },
  plugins: [
    organization({
      teams: { enabled: true },
      schema: {
        organization: { additionalFields: { billingId: { type: "string", required: true } } },
      },
    }),
  ],
});
// The wrapped native organization plugin retains optional upstream capabilities.
void auth.api.createTeam;
const helpers = createAuthHelpers(auth);
new Elysia().use(helpers.elysia()).get(
  "/typed",
  ({ user }) => {
    const plan: string = user.plan;
    // @ts-expect-error Native inferred custom fields are not erased to any.
    const invalid: number = user.plan;
    return { plan, invalid };
  },
  { auth: true },
);
async function typedOrganization(request: Request) {
  const org = await helpers.getOrganizationBySlug(request, "example");
  if (org) {
    const billing: string = org.billingId;
    // @ts-expect-error Organization custom fields keep their native inferred type.
    const invalid: number = org.billingId;
    void invalid;
    return billing;
  }
}
void typedOrganization;
