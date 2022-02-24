import { Logger } from '../../logger';
import { CompileOptions } from 'svelte/types/compiler/interfaces';
import { PreprocessorGroup } from 'svelte/types/compiler/preprocess/types';
import { importSveltePreprocess } from '../../importPackage';
import _glob from 'fast-glob';
import _path, { dirname } from 'path';
import { loadConfig as unconfigLoad } from 'unconfig';

export type InternalPreprocessorGroup = PreprocessorGroup & {
    /**
     * svelte-preprocess has this since 4.x
     */
    defaultLanguages?: {
        markup?: string;
        script?: string;
        style?: string;
    };
};

export interface SvelteConfig {
    compilerOptions?: CompileOptions;
    preprocess?: InternalPreprocessorGroup | InternalPreprocessorGroup[];
    loadConfigError?: any;
}

const DEFAULT_OPTIONS: CompileOptions = {
    dev: true
};

const NO_GENERATE: CompileOptions = {
    generate: false
};

/**
 * Loads svelte.config.{js,cjs,mjs} files. Provides both a synchronous and asynchronous
 * interface to get a config file because snapshots need access to it synchronously.
 * This means that another instance (the ts service host on startup) should make
 * sure that all config files are loaded before snapshots are retrieved.
 * Asynchronousity is needed because we use the dynamic `import()` statement.
 */
export class ConfigLoader {
    private configFiles = new Map<string, SvelteConfig>();
    private disabled = false;

    constructor() {}

    /**
     * Enable/disable loading of configs (for security reasons for example)
     */
    setDisabled(disabled: boolean): void {
        this.disabled = disabled;
    }

    private defaultConfig(dir?: string): SvelteConfig {
        return {
            ...(dir ? this.useFallbackPreprocessor(dir) : {}),
            compilerOptions: {
                ...DEFAULT_OPTIONS,
                ...NO_GENERATE
            }
        };
    }

    async loadAndCacheConfig(dir: string) {
        const { config } = await unconfigLoad<SvelteConfig>({
            cwd: dir,
            sources: [{ files: 'svelte.config'}],
            defaults: this.defaultConfig(dir)
        });
        this.configFiles.set(dir, config);
        return config;
    }

    /**
     * Returns config associated to file. If no config is found, the file
     * was called in a context where no config file search was done before,
     * which can happen
     * - if TS intellisense is turned off and the search did not run on tsconfig init
     * - if the file was opened not through the TS service crawl, but through the LSP
     */
    async getConfig(file: string): Promise<SvelteConfig | undefined> {
        if (this.disabled) {
            return undefined;
        }

        const dir = _path.dirname(file);
        return this.configFiles.get(dir) || await this.loadAndCacheConfig(dir);
    }

    getConfigSync(file: string): SvelteConfig | undefined {
        if (this.disabled) {
            return undefined;
        }
        const dir = _path.dirname(file);
        return this.configFiles.get(dir) || undefined;
    }

    private useFallbackPreprocessor(path: string): SvelteConfig {
        Logger.log('No valid svelte.config.js found. Using https://github.com/sveltejs/svelte-preprocess as fallback');
        const sveltePreprocess = importSveltePreprocess(path);
        return {
            preprocess: sveltePreprocess({
                // 4.x does not have transpileOnly anymore, but if the user has version 3.x
                // in his repo, that one is loaded instead, for which we still need this.
                typescript: <any>{
                    transpileOnly: true,
                    compilerOptions: { sourceMap: true, inlineSourceMap: false }
                }
            })
        };
    }

    async preloadConfigs(dir: string): Promise<SvelteConfig[]> {
        const files = await _glob(['**/*.{svelte,ts,js,mts,mjs,cjs,cts}'], { cwd: dir });

        return Promise.all(files.map((file) => {
            return this.loadAndCacheConfig(dirname(file));
        }));
    }
}

export const configLoader = new ConfigLoader();
