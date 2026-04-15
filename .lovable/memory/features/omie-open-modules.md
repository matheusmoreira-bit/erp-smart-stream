---
name: OMIE open modules
description: Temporary rule: OMIE companies must keep all modules unlocked for all users without permission-level control.
type: feature
---

All OMIE companies bypass permission group checks — every user gets ALL modules unlocked.
Implemented in useModuleAccess: early return when session.erpType === "omie".
