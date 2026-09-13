// A host-kind token minted by an application (desktop / web / cli / …).
// Referenced by identity, like ServiceKey — never as a bare string — so the
// enums-over-literals rule holds while the set stays app-extensible: the
// framework ships no kinds; each app declares its own vocabulary.
export class HostKind
{
    constructor(public readonly Name: string) { }

    public toString(): string { return `HostKind(${this.Name})`; }
}
