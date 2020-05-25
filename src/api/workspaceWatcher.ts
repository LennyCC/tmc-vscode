import * as del from "del";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import { ExerciseStatus, LocalExerciseData } from "../config/types";
import Resources from "../config/resources";
import { WORKSPACE_ROOT_FILE, WORKSPACE_ROOT_FILE_TEXT } from "../config/constants";
import WorkspaceManager from "./workspaceManager";
import Logger from "../utils/logger";
import { showError } from "../utils";

export default class WorkspaceWatcher {
    private readonly folderTree: Map<string, Map<string, Set<string>>> = new Map();
    private readonly resources: Resources;
    private readonly workspaceManager: WorkspaceManager;
    private readonly logger: Logger;
    public running: boolean;
    private watcher?: vscode.FileSystemWatcher;

    constructor(workspaceManager: WorkspaceManager, resources: Resources, logger: Logger) {
        this.resources = resources;
        this.logger = logger;
        this.workspaceManager = workspaceManager;
        this.running = false;
        this.logger.log("WorkspaceWatcher initializing");
        for (const exercise of workspaceManager.getAllExercises()) {
            if (exercise.status === ExerciseStatus.OPEN) {
                this.watch(exercise);
            }
        }
    }

    public start(): void {
        if (this.running) {
            this.logger.warn("WorkspaceWatcher already running.");
        }
        this.running = true;
        this.sweep();
        if (!this.watcher) {
            this.watcher = vscode.workspace.createFileSystemWatcher(
                this.resources.getExercisesFolderPath() + "/**",
                false,
                false,
                false,
            );
            this.logger.log(
                `Watcher started watching for file changes at ${
                    this.resources.getExercisesFolderPath() + "/**"
                }`,
            );
            this.watcher.onDidCreate((x) => {
                if (x.scheme === "file") {
                    this.fileCreateAction(x.fsPath);
                }
            });
            this.watcher.onDidDelete((x) => {
                if (x.scheme === "file") {
                    this.fileDeleteAction(x.fsPath);
                }
            });
            this.watcher.onDidChange((x) => {
                if (x.scheme === "file") {
                    this.fileChangeAction(x.fsPath);
                }
            });
        }
    }

    public stop(): void {
        if (!this.running) {
            this.logger.warn("WorkspaceWatcher already stopped.");
        }
        this.watcher?.dispose();
        this.watcher = undefined;
        this.running = false;
        this.logger.log("Watcher stopped");
    }

    public watch({ organization, course, name }: LocalExerciseData): void {
        this.logger.logVerbose("Watcher watching data for", true, organization, course, name);
        if (!this.folderTree.has(organization)) {
            this.folderTree.set(organization, new Map());
        }
        if (!this.folderTree.get(organization)?.has(course)) {
            this.folderTree.get(organization)?.set(course, new Set());
        }
        this.folderTree.get(organization)?.get(course)?.add(name);
    }

    public unwatch({ organization, course, name }: LocalExerciseData): void {
        this.logger.logVerbose("Watcher unwatching data for", true, organization, course, name);
        if (this.folderTree.get(organization)?.has(course)) {
            this.folderTree.get(organization)?.get(course)?.delete(name);
            if (this.folderTree.get(organization)?.get(course)?.size === 0) {
                this.folderTree.get(organization)?.delete(course);
                if (this.folderTree.get(organization)?.size === 0) {
                    this.folderTree.delete(organization);
                }
            }
        }
    }

    private sweep(): void {
        const basedir = this.resources.getExercisesFolderPath();

        try {
            this.logger.log("Watcher starting to sweep");
            fs.readdirSync(basedir, { withFileTypes: true }).forEach((organization) => {
                if (organization.isFile() && organization.name === WORKSPACE_ROOT_FILE) {
                    if (
                        fs.readFileSync(path.join(basedir, organization.name), {
                            encoding: "utf-8",
                        }) !== WORKSPACE_ROOT_FILE_TEXT
                    ) {
                        this.logger.log(`Writing ${WORKSPACE_ROOT_FILE} at ${basedir}`);
                        fs.writeFileSync(
                            path.join(basedir, organization.name),
                            WORKSPACE_ROOT_FILE_TEXT,
                            { encoding: "utf-8" },
                        );
                    }
                    return;
                } else if (
                    !(organization.isDirectory() && this.folderTree.has(organization.name))
                ) {
                    this.logger.warn(
                        `Unknown item ${organization.name} - Removing from ${basedir}`,
                    );
                    del.sync(path.join(basedir, organization.name), { force: true });
                } else {
                    fs.readdirSync(path.join(basedir, organization.name), {
                        withFileTypes: true,
                    }).forEach((course) => {
                        if (
                            !(
                                this.folderTree.get(organization.name)?.has(course.name) &&
                                course.isDirectory()
                            )
                        ) {
                            this.logger.warn(
                                `Course ${course.name} not found in ${organization.name} - Removing form ${basedir}`,
                            );
                            del.sync(path.join(basedir, organization.name, course.name), {
                                force: true,
                            });
                        } else {
                            fs.readdirSync(path.join(basedir, organization.name, course.name), {
                                withFileTypes: true,
                            }).forEach((exercise) => {
                                if (
                                    !(
                                        this.folderTree
                                            .get(organization.name)
                                            ?.get(course.name)
                                            ?.has(exercise.name) && exercise.isDirectory()
                                    )
                                ) {
                                    this.logger.warn(
                                        `Exercise ${exercise.name} not found in ${course.name} - Removing from ${basedir}`,
                                    );
                                    del.sync(
                                        path.join(
                                            basedir,
                                            organization.name,
                                            course.name,
                                            exercise.name,
                                        ),
                                        { force: true },
                                    );
                                }
                            });
                        }
                    });
                }
            });
            this.logger.log("Watcher completed sweeping without errors");
        } catch (error) {
            this.logger.error("Fatal error while sweeping", error);
            this.logger.show();
            showError("External file error, please restart Visual Studio Code to repair.");
        }
    }

    private fileCreateAction(targetPath: string): void {
        this.logger.log(`File created ${targetPath}`);
        const basedir = this.resources.getExercisesFolderPath();
        const relation = path.relative(basedir, targetPath).toString().split(path.sep, 3);
        if (relation[0] === "..") {
            return;
        }
        if (
            relation.length > 0 &&
            !this.folderTree.has(relation[0]) &&
            relation[0] !== WORKSPACE_ROOT_FILE
        ) {
            const pathToRemove = path.join(basedir, relation[0]);
            this.logger.warn(`Removing ${pathToRemove}`);
            del.sync(pathToRemove, {
                force: true,
            });
            return;
        }
        if (relation.length > 1 && !this.folderTree.get(relation[0])?.has(relation[1])) {
            const pathToRemove = path.join(basedir, relation[0], relation[1]);
            this.logger.warn(`Removing ${pathToRemove}`);
            del.sync(pathToRemove, {
                force: true,
            });
            return;
        }
        if (
            relation.length > 2 &&
            !this.folderTree.get(relation[0])?.get(relation[1])?.has(relation[2])
        ) {
            const pathToRemove = path.join(basedir, ...relation);
            this.logger.warn(`Removing ${pathToRemove}`);
            del.sync(pathToRemove, {
                force: true,
            });
            return;
        }
    }

    /**
     * Marks exercise data as missing if deleted, missing exercises are treated the same
     * as closed exercises by the watcher
     */
    private fileDeleteAction(targetPath: string): void {
        this.logger.log(`File deleted ${targetPath}`);
        const basedir = this.resources.getExercisesFolderPath();
        const rootFilePath = path.join(basedir, WORKSPACE_ROOT_FILE);

        if (path.relative(rootFilePath, targetPath) === "") {
            fs.writeFileSync(targetPath, WORKSPACE_ROOT_FILE_TEXT, { encoding: "utf-8" });
            return;
        }

        const relation = path.relative(basedir, targetPath).toString().split(path.sep, 4);

        if (relation[0] === "..") {
            return;
        }
        if (relation.length === 1 && this.folderTree.has(relation[0])) {
            this.workspaceManager
                .getAllExercises()
                .filter((x) => x.organization === relation[0] && x.status === ExerciseStatus.OPEN)
                .forEach((x) => {
                    this.logger.warn(
                        `Exercise data marked as missing for organization ${x.organization}`,
                    );
                    this.workspaceManager.setMissing(x.id);
                    this.unwatch(x);
                });
            return;
        }
        if (relation.length === 2 && this.folderTree.get(relation[0])?.has(relation[1])) {
            this.workspaceManager
                .getAllExercises()
                .filter(
                    (x) =>
                        x.organization === relation[0] &&
                        x.course === relation[1] &&
                        x.status === ExerciseStatus.OPEN,
                )
                .forEach((x) => {
                    this.logger.warn(`Exercise data marked as missing for course ${x.course}`);
                    this.workspaceManager.setMissing(x.id);
                    this.unwatch(x);
                });
            return;
        }
        if (
            relation.length === 3 &&
            this.folderTree.get(relation[0])?.get(relation[1])?.has(relation[2])
        ) {
            this.workspaceManager
                .getAllExercises()
                .filter(
                    (x) =>
                        x.organization === relation[0] &&
                        x.course === relation[1] &&
                        x.name === relation[2] &&
                        x.status === ExerciseStatus.OPEN,
                )
                .forEach((x) => {
                    this.logger.warn(`Exercise data marked as missing for exercise ${x.name}`);
                    this.workspaceManager.setMissing(x.id);
                    this.unwatch(x);
                });
            return;
        }
    }

    /**
     * Keeps the workspace root file in order
     */
    private fileChangeAction(targetPath: string): void {
        const rootFilePath = path.join(
            this.resources.getExercisesFolderPath(),
            WORKSPACE_ROOT_FILE,
        );

        if (path.relative(rootFilePath, targetPath) === "") {
            if (fs.readFileSync(rootFilePath, { encoding: "utf-8" }) !== WORKSPACE_ROOT_FILE_TEXT) {
                this.logger.log(`Rewriting ${WORKSPACE_ROOT_FILE_TEXT} at ${targetPath}`);
                fs.writeFileSync(targetPath, WORKSPACE_ROOT_FILE_TEXT, { encoding: "utf-8" });
            }
        }
    }
}