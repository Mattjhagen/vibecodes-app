import { Blueprint, FileOutputType } from '../../schemas';
import { TemplateDetails } from '../../../services/sandbox/sandboxTypes';
import { CodeGenState, PhaseState } from '../../core/state';
import { DependencyManagement } from '../pure/DependencyManagement';
import type { StructuredLogger } from '../../../logger';
import { FileProcessing } from '../pure/FileProcessing';

/**
 * Immutable context for code generation operations
 * Contains all necessary data for generating code
 */
export class GenerationContext {
    constructor(
        public readonly query: string,
        public readonly blueprint: Blueprint,
        public readonly templateDetails: TemplateDetails,
        public readonly dependencies: Record<string, string>,
        public readonly allFiles: FileOutputType[],
        public readonly generatedPhases: PhaseState[],
        public readonly commandsHistory: string[]
    ) {
        // Freeze to ensure immutability
        Object.freeze(this);
        Object.freeze(this.dependencies);
        Object.freeze(this.allFiles);
        Object.freeze(this.generatedPhases);
        Object.freeze(this.commandsHistory);
    }

    /**
     * Create context from current state
     */
    static from(state: CodeGenState, logger?: Pick<StructuredLogger, 'info' | 'warn'>): GenerationContext {
        const dependencies = DependencyManagement.mergeDependencies(
            state.templateDetails?.deps || {},
            state.lastPackageJson,
            logger
        );

        const allFiles = FileProcessing.getAllFiles(
            state.templateDetails,
            state.generatedFilesMap
        );

        return new GenerationContext(
            state.query,
            state.blueprint,
            state.templateDetails,
            dependencies,
            allFiles,
            state.generatedPhases,
            state.commandsHistory || []
        );
    }

    /**
     * Get formatted phases for prompt generation
     */
    getCompletedPhases() {
        return Object.values(this.generatedPhases.filter(phase => phase.completed));
    }
}