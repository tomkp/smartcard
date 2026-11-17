/**
 * vsmartcard's virtual card, for the tests in this folder and for
 * with-card.ts. See README.md here.
 *
 * vpcd, a pcscd driver, adds the readers "Virtual PCD 00 00" and
 * "Virtual PCD 00 01". vicc, a card emulator, is a card in the first one
 * for as long as it runs.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { Context, SCARD_STATE_PRESENT } from '../../lib';
import type { Context as PCSCContext } from '../../lib/types';

export const READER = 'Virtual PCD 00 00';
// ISO 7816 SELECT with no AID, which the virtual card answers with 6A 82
export const SELECT = Buffer.from([0x00, 0xa4, 0x04, 0x00, 0x00]);
export const SELECT_RESPONSE = '6a82';

// Set (to anything) where the virtual card must be available, as in CI:
// then a missing setup fails the tests instead of skipping them
export const REQUIRED = Boolean(process.env.SMARTCARD_VIRTUAL_CARD_REQUIRED);

// Set (to anything) to let tests stop and start pcscd, to simulate a
// service outage: as root, or with passwordless sudo. Only where pcscd is
// started with `pcscd --disable-polkit` rather than by systemd (CI, the
// Docker image), since the tests start it that way again.
export const RESTART_PCSCD = Boolean(process.env.SMARTCARD_TEST_RESTART_PCSCD);

const TIMEOUT = 15000;

function readerState(context: PCSCContext): number | null {
    const reader = context.listReaders().find((r) => r.name === READER);
    return reader ? reader.state : null;
}

// Why the virtual card can't be used here, or undefined if it can
export function unavailable(): string | undefined {
    if (spawnSync('vicc', ['--version']).status !== 0) {
        return 'vicc (vsmartcard) is not installed';
    }
    let context: PCSCContext;
    try {
        context = new Context();
    } catch (err) {
        return `no PC/SC service: ${(err as Error).message}`;
    }
    try {
        if (readerState(context) === null) {
            return `pcscd has no "${READER}" (is vsmartcard-vpcd installed?)`;
        }
    } finally {
        context.close();
    }
    return undefined;
}

// Poll condition until it holds; detail() explains a timeout
export async function waitFor(
    condition: () => boolean,
    what: string,
    detail: () => string = () => ''
): Promise<void> {
    const deadline = Date.now() + TIMEOUT;
    while (!condition()) {
        if (Date.now() > deadline) {
            const extra = detail();
            throw new Error(`timed out waiting for ${what}${extra ? `: ${extra}` : ''}`);
        }
        await new Promise((r) => setTimeout(r, 50));
    }
}

// The card is in the reader while vicc runs
export class VirtualCard {
    private vicc: ChildProcess | null = null;
    private output = '';

    get running(): boolean {
        const vicc = this.vicc;
        return vicc !== null && vicc.exitCode === null && vicc.signalCode === null;
    }

    present(): boolean {
        let context: PCSCContext;
        try {
            context = new Context();
        } catch {
            return false; // no service, so no card
        }
        try {
            const state = readerState(context);
            return state !== null && (state & SCARD_STATE_PRESENT) !== 0;
        } finally {
            context.close();
        }
    }

    // vicc's output so far, for failure messages
    log(): string {
        return this.output.trim().split('\n').slice(-10).join('\n');
    }

    async insert(): Promise<void> {
        await this.remove();
        this.output = '';
        // vicc exits at once if vpcd isn't listening yet (pcscd starting)
        for (let attempt = 1; ; attempt++) {
            const vicc = spawn('vicc', ['--type', 'iso7816'], { stdio: ['ignore', 'pipe', 'pipe'] });
            this.vicc = vicc;
            vicc.stdout?.on('data', (d) => (this.output += d));
            vicc.stderr?.on('data', (d) => (this.output += d));
            vicc.on('error', (err) => (this.output += `\n${err.message}`));
            await waitFor(
                () => !this.running || this.present(),
                'the virtual card to be inserted',
                () => this.log()
            );
            if (this.running) {
                return;
            }
            if (attempt === 3) {
                throw new Error(`vicc exited before the card was inserted:\n${this.log()}`);
            }
            await new Promise((r) => setTimeout(r, 500));
        }
    }

    async remove(): Promise<void> {
        const vicc = this.vicc;
        this.vicc = null;
        if (vicc === null) {
            return;
        }
        if (vicc.exitCode === null && vicc.signalCode === null) {
            const exited = new Promise((r) => vicc.once('exit', r));
            vicc.kill();
            await exited;
        }
        await waitFor(() => !this.present(), 'the virtual card to be removed');
    }
}

function asRoot(command: string[]): number {
    const argv = process.getuid?.() === 0 ? command : ['sudo', '-n', ...command];
    return spawnSync(argv[0], argv.slice(1)).status ?? 1;
}

function serviceUp(): boolean {
    try {
        new Context().close();
        return true;
    } catch {
        return false;
    }
}

// Stop and start pcscd (RESTART_PCSCD)
export const pcscd = {
    async stop(): Promise<void> {
        asRoot(['pkill', '-x', 'pcscd']);
        await waitFor(
            () => spawnSync('pgrep', ['-x', 'pcscd']).status !== 0 && !serviceUp(),
            'pcscd to stop'
        );
    },
    async start(): Promise<void> {
        if (asRoot(['pcscd', '--disable-polkit']) !== 0) {
            throw new Error('could not start pcscd');
        }
        // Up, with vpcd's reader created (and so listening for vicc)
        await waitFor(() => {
            if (!serviceUp()) {
                return false;
            }
            const context = new Context();
            try {
                return readerState(context) !== null;
            } finally {
                context.close();
            }
        }, 'pcscd to start');
    },
};
