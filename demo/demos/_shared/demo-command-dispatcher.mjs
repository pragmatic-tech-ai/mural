export class DemoCommandDispatcher {
    commandsById;
    constructor(commandsById) {
        this.commandsById = commandsById;
    }
    Resolve(commandId, _context) {
        return this.commandsById.get(commandId);
    }
}
