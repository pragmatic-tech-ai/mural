import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { initTestApp } from '../../../basic/tests/test-app.js';
import { Board } from '../board.js';

// § board input modes — Connectors mode. The Board exposes a
// ConnectorsModePinned DP that gates the connector adorners' reactivity; a
// consumer binds a ToolBarToggleButton's IsChecked to it (see the demo's modes
// toolbar). Momentary Ctrl activation is handled inside the connector behavior
// per pointer event (it reads the event modifiers, so it needs a live pointer
// pipeline — not covered here).

describe('Board — Connectors input mode', () => {
    beforeEach(() => { initTestApp(); });

    test('ConnectorsModePinned defaults off', () => {
        const d = new Board();
        assert.equal(d.ConnectorsModePinned, false);
    });

    test('ConnectorsModePinned round-trips (the toggle binding source)', () => {
        const d = new Board();
        d.ConnectorsModePinned = true;
        assert.equal(d.ConnectorsModePinned, true);
        d.ConnectorsModePinned = false;
        assert.equal(d.ConnectorsModePinned, false);
    });
});
