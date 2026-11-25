# Prinpo Stack

Prinpo Stack provides a consistent foundation for applications assembled from a shared technology stack.

## Language

**Stack**:
The thin application framework that brings the selected libraries together through a shared public interface and documented patterns.
_Avoid_: Dependency bundle, starter template

**Stack configuration**:
An application's declaration of how Stack coordinates its commands and capabilities. It describes application policy across deployments.

**Lifecycle script**:
An application-owned script registered with Stack to run at a named phase of a Stack command.

**Block**:
A composable capability of Stack that can be used independently wherever its underlying libraries allow.
_Avoid_: Preset, template

**Jobs Block**:
The Block for defining, submitting, and processing background work with a shared, type-safe contract.
_Avoid_: Jobs server

**i18n Block**:
The optional Block for localizing an application's frontend and backend with application-owned translations.
