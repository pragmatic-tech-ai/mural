import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TokenSnapshot } from '../token-snapshot.js';

/**
 * Test fixture — the Pragmatic design system's `tokens.json`, the source of
 * truth the theme is checked against. It lives in the private dev-kit
 * repository, read from the sibling checkout (`../dev-kit` beside Mural), as
 * in the workspace and on the hive laptop. A checkout without that sibling
 * (Mural's CI, which cannot read the private repository) skips the suites that
 * need it rather than failing them.
 *
 * Helper file (not a .test.ts) so the test runner doesn't pick it up.
 */
export class DesignSystemTokens
{
    private static readonly TokensUrl = new URL('../../../../../dev-kit/design/design-systems/pragmatic/tokens.json', import.meta.url);
    private static readonly TokensPath = fileURLToPath(DesignSystemTokens.TokensUrl);
    private static readonly Encoding = 'utf8';
    private static readonly MissingReason = 'design-system tokens.json not found (needs the sibling dev-kit checkout): ';

    /** False when the sibling dev-kit checkout is present; otherwise the reason to skip, for `describe(..., { skip })`. */
    public static SkipReason(): string | false
    {
        return existsSync(DesignSystemTokens.TokensPath) ? false : DesignSystemTokens.MissingReason + DesignSystemTokens.TokensPath;
    }

    public static Load(): TokenSnapshot
    {
        return new TokenSnapshot(JSON.parse(readFileSync(DesignSystemTokens.TokensPath, DesignSystemTokens.Encoding)));
    }
}
