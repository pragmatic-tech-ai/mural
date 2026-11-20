import { registerHooks, type ResolveFnOutput, type ResolveHookContext } from 'node:module';

/**
 * Test fixture — lets a test import the compiled demos under `demo/` without
 * the demo's own `npm install`.
 *
 * The compiled demo modules import Mural by its package name
 * (`@pragmatic-tech-ai/mural/basic`, ...). `demo/` is its own package
 * (`@pragmatic-tech-ai/mural-demo`), so a package self-reference does not
 * apply there; Node finds Mural only through `demo/node_modules`, the
 * `file:..` link that `npm install` inside `demo/` creates. A fresh clone
 * (the hive laptop, CI) has no such link and the import fails with
 * ERR_MODULE_NOT_FOUND.
 *
 * `Install()` registers a resolve hook that resolves a Mural specifier
 * imported from inside `demo/` as if it were imported from the Mural
 * package root, i.e. as a self-reference through Mural's own `exports`
 * (honouring the active `--conditions`). That lands on the same files the
 * tests import relatively, so the demo and the test share module instances.
 *
 * Helper file (not a .test.ts) so the test runner doesn't pick it up.
 */
export class DemoModuleResolution
{
    private static readonly PackageName = '@pragmatic-tech-ai/mural';
    private static readonly SubpathSeparator = '/';
    private static readonly RepoRoot = new URL('../../../', import.meta.url);
    private static readonly PackageJsonUrl = new URL('package.json', DemoModuleResolution.RepoRoot).href;
    private static readonly DemoFolderUrl = new URL('demo/', DemoModuleResolution.RepoRoot).href;

    private static installed = false;

    /** Registers the hook once per process; later calls are no-ops. */
    public static Install(): void
    {
        if (DemoModuleResolution.installed) return;
        DemoModuleResolution.installed = true;
        registerHooks({ resolve: (specifier, context, nextResolve) => DemoModuleResolution.Resolve(specifier, context, nextResolve) });
    }

    private static Resolve(
        specifier: string,
        context: ResolveHookContext,
        nextResolve: (specifier: string, context?: Partial<ResolveHookContext>) => ResolveFnOutput): ResolveFnOutput
    {
        if (DemoModuleResolution.IsMuralSpecifier(specifier) && DemoModuleResolution.IsInsideDemo(context.parentURL))
        {
            return nextResolve(specifier, { ...context, parentURL: DemoModuleResolution.PackageJsonUrl });
        }
        return nextResolve(specifier, context);
    }

    private static IsMuralSpecifier(specifier: string): boolean
    {
        return specifier === DemoModuleResolution.PackageName
            || specifier.startsWith(DemoModuleResolution.PackageName + DemoModuleResolution.SubpathSeparator);
    }

    private static IsInsideDemo(parentUrl: string | undefined): boolean
    {
        return parentUrl !== undefined
            && parentUrl.toLowerCase().startsWith(DemoModuleResolution.DemoFolderUrl.toLowerCase());
    }
}
