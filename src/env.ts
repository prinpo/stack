/** Browser-safe native Varlock access and public configuration hydration. */
export {
  ENV,
  clearPublicDynamicEnv,
  getPublicDynamicConfigKeys,
  getPublicDynamicEnv,
  loadPublicDynamicEnv,
  setPublicDynamicEnv,
  type PublicTypedEnvSchema,
  type TypedEnvSchema,
} from "varlock/env";
