# Key namespaces

Repo-wide allocation of string-key ownership (Solution Hierarchy design §17). Each
string-key domain has ONE owner class; this file records which prefix/family each
module owns. A compose-time `NodeKeyRegistry.DeclareOwned` collision check enforces
node-key ownership (two owners of one key throw).

## Node keys (hierarchy families — `NodeKey.*`)

| Key | Owner | Notes |
|-----|-------|-------|
| `solution` | mural/framework (`NodeKey.Solution`) | the root family |
| `project` | mural/framework (`NodeKey.Project`) | coarse family; the project TYPE lives on the instance, never the key |
| `connections` | mural/framework (`NodeKey.Connections`) | P5 |
| `references` | mural/framework (`NodeKey.References`) | P5 |
| `folder` / `file` / `diagram` / `todl` | TODL (`ContentNodeKey`, `solution-services/project-services/content`) | P1 content-node presentation families; provider-scoped (below the provider boundary — never contributor-matched); not in mural's `NodeKey` |

## Other string-key domains (existing)

| Domain | Owner |
|--------|-------|
| Diagram setting keys | `DiagramSettingKey` (mural framework/diagram) |
| Diagram command ids | `DiagramCommandId` (mural framework/diagram) |
| Project type ids | per-app factory consts (e.g. `TODL_PACKAGE_TYPE`) |
