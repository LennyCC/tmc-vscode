/**
 * -------------------------------------------------------------------------------------------------
 * Group of actions that respond to the user.
 * -------------------------------------------------------------------------------------------------
 */

import { sync as delSync } from "del";
import du = require("du");
import * as fs from "fs-extra";
import * as path from "path";
import { Err, Ok, Result } from "ts-results";
import * as vscode from "vscode";

import { SubmissionFeedback } from "../api/types";
import { EXAM_SUBMISSION_RESULT, EXAM_TEST_RESULT, NOTIFICATION_DELAY } from "../config/constants";
import { ExerciseStatus, LocalCourseData } from "../config/types";
import { AuthorizationError, ConnectionError } from "../errors";
import { TestResultData, VisibilityGroups } from "../ui/types";
import {
    formatSizeInBytes,
    isCorrectWorkspaceOpen,
    Logger,
    parseFeedbackQuestion,
    sleep,
} from "../utils/";
import {
    askForConfirmation,
    getActiveEditorExecutablePath,
    showError,
    showNotification,
} from "../window";

import { ActionContext, FeedbackQuestion } from "./types";
import { displayUserCourses, selectOrganizationAndCourse } from "./webview";
import {
    checkForExerciseUpdates,
    closeExercises,
    downloadExercises,
    openExercises,
} from "./workspace";

/**
 * Authenticates and logs the user in if credentials are correct.
 */
export async function login(
    actionContext: ActionContext,
    username: string,
    password: string,
    visibilityGroups: VisibilityGroups,
): Promise<Result<void, Error>> {
    const { tmc, ui } = actionContext;

    if (!username || !password) {
        return new Err(new Error("Username and password may not be empty."));
    }

    const result = await tmc.authenticate(username, password);
    if (result.err) {
        return result;
    }

    ui.treeDP.updateVisibility([visibilityGroups.LOGGED_IN]);
    return Ok.EMPTY;
}

/**
 * Logs the user out, updating UI state
 */
export async function logout(
    actionContext: ActionContext,
    visibility: VisibilityGroups,
): Promise<void> {
    if (await askForConfirmation("Are you sure you want to log out?")) {
        const { tmc, ui } = actionContext;
        const result = await tmc.deauthenticate();
        if (result.err) {
            const message = "Failed to log out.";
            showError(message);
            Logger.error(message, result.val);
            return;
        }
        ui.webview.dispose();
        ui.treeDP.updateVisibility([visibility.LOGGED_IN.not]);
        showNotification("Logged out from TestMyCode.");
    }
}

/**
 * Tests an exercise while keeping the user informed
 */
export async function testExercise(actionContext: ActionContext, id: number): Promise<void> {
    const { ui, tmc, userData, workspaceManager, temporaryWebviewProvider } = actionContext;
    const exerciseDetails = workspaceManager.getExerciseDataById(id);
    if (exerciseDetails.err) {
        const message = "Getting exercise details failed when testing exercise.";
        Logger.error(message, exerciseDetails.val);
        showError(message);
        return;
    }

    const disabled = userData.getCourse(id).disabled;
    let data: TestResultData = { ...EXAM_TEST_RESULT, id, disabled };
    const temp = temporaryWebviewProvider.getTemporaryWebview();

    if (disabled) {
        const executablePath = getActiveEditorExecutablePath(actionContext);
        const [testRunner, interrupt] = tmc.runTests(id, executablePath);
        let aborted = false;
        const exerciseName = exerciseDetails.val.name;

        temp.setContent({
            title: "TMC Running tests",
            template: { templateName: "running-tests", exerciseName },
            messageHandler: async (msg: { type?: string; data?: { [key: string]: unknown } }) => {
                if (msg.type === "closeWindow") {
                    temp.dispose();
                } else if (msg.type === "abortTests") {
                    interrupt();
                    aborted = true;
                }
            },
        });
        ui.setStatusBar(`Running tests for ${exerciseName}`);
        Logger.log(`Running local tests for ${exerciseName}`);

        const testResult = await testRunner;
        if (testResult.err) {
            ui.setStatusBar(
                `Running tests for ${exerciseName} ${aborted ? "aborted" : "failed"}`,
                5000,
            );
            if (aborted) {
                temp.dispose();
                return;
            }
            temp.setContent({
                title: "TMC",
                template: { templateName: "error", error: testResult.val },
                messageHandler: (msg: { type?: string }) => {
                    if (msg.type === "closeWindow") {
                        temp.dispose();
                    }
                },
            });
            temporaryWebviewProvider.addToRecycables(temp);
            const message = "Exercise test run failed.";
            Logger.error(message, testResult.val);
            showError(message);
            return;
        }
        ui.setStatusBar(`Tests finished for ${exerciseName}`, 5000);
        Logger.log(`Tests finished for ${exerciseName}`);
        data = {
            testResult: testResult.val,
            id,
            exerciseName,
            tmcLogs: {},
            disabled,
        };
    }

    // Set test-result handlers.
    temp.setContent({
        title: "TMC Test Results",
        template: { templateName: "test-result", ...data, pasteLink: "" },
        messageHandler: async (msg: { type?: string; data?: { [key: string]: unknown } }) => {
            if (msg.type === "submitToServer" && msg.data) {
                submitExercise(actionContext, msg.data.exerciseId as number);
            } else if (msg.type === "sendToPaste" && msg.data) {
                const pasteLink = await pasteExercise(actionContext, msg.data.exerciseId as number);
                pasteLink && temp.postMessage({ command: "showPasteLink", pasteLink });
            } else if (msg.type === "closeWindow") {
                temp.dispose();
            }
        },
    });
    temporaryWebviewProvider.addToRecycables(temp);
}

/**
 * Submits an exercise while keeping the user informed
 * @param tempView Existing TemporaryWebview to use if any
 */
export async function submitExercise(actionContext: ActionContext, id: number): Promise<void> {
    const { ui, temporaryWebviewProvider, tmc, userData, workspaceManager } = actionContext;
    Logger.log(
        `Submitting exercise ${workspaceManager.getExerciseDataById(id).val.name} to server`,
    );
    const submitResult = await tmc.submitExercise(id);
    const exerciseDetails = workspaceManager.getExerciseDataById(id);
    if (exerciseDetails.err) {
        const message = "Getting exercise details failed when submitting exercise.";
        Logger.error(message, exerciseDetails.val);
        showError(message);
        return;
    }
    const courseData = userData.getCourse(id);
    const temp = temporaryWebviewProvider.getTemporaryWebview();

    if (submitResult.err) {
        temp.setContent({
            title: "TMC Server Submission",
            template: { templateName: "error", error: submitResult.val },
            messageHandler: async (msg: { type?: string }): Promise<void> => {
                if (msg.type === "closeWindow") {
                    temp.dispose();
                }
            },
        });
        const message = "Exercise submission failed.";
        Logger.error(message, submitResult.val);
        showError(message);
        return;
    }

    if (courseData.perhapsExamMode) {
        const examData = EXAM_SUBMISSION_RESULT;
        const submitUrl = submitResult.val.show_submission_url;
        const feedbackQuestions: FeedbackQuestion[] = [];
        temp.setContent({
            title: "TMC Server Submission",
            template: {
                templateName: "submission-result",
                statusData: examData,
                feedbackQuestions,
            },
            messageHandler: async (msg: { type?: string }) => {
                if (msg.type === "closeWindow") {
                    temp.dispose();
                } else if (msg.type === "showInBrowser") {
                    vscode.env.openExternal(vscode.Uri.parse(submitUrl));
                }
            },
        });
        temporaryWebviewProvider.addToRecycables(temp);
        return;
    }

    const messageHandler = async (msg: {
        data?: { [key: string]: unknown };
        type?: string;
    }): Promise<void> => {
        if (msg.type === "feedback" && msg.data) {
            await tmc.submitSubmissionFeedback(
                msg.data.url as string,
                msg.data.feedback as SubmissionFeedback,
            );
        } else if (msg.type === "showInBrowser") {
            vscode.env.openExternal(vscode.Uri.parse(submitResult.val.show_submission_url));
        } else if (msg.type === "showSolutionInBrowser" && msg.data) {
            vscode.env.openExternal(vscode.Uri.parse(msg.data.solutionUrl as string));
        } else if (msg.type === "closeWindow") {
            temp.dispose();
        } else if (msg.type === "sendToPaste" && msg.data) {
            Logger.debug(msg.data);
            const pasteLink = await pasteExercise(actionContext, Number(msg.data.exerciseId));
            pasteLink && temp.postMessage({ command: "showPasteLink", pasteLink });
        }
    };

    let notified = false;
    let timeWaited = 0;
    let getStatus = true;
    while (getStatus) {
        const statusResult = await tmc.getSubmissionStatus(submitResult.val.submission_url);
        if (statusResult.err) {
            const message = "Failed getting submission status.";
            Logger.error(message, statusResult.val);
            showError(message);
            break;
        }
        const statusData = statusResult.val;
        if (statusResult.val.status !== "processing") {
            ui.setStatusBar("Tests finished, see result", 5000);
            let feedbackQuestions: FeedbackQuestion[] = [];
            let courseId = undefined;
            if (statusData.status === "ok" && statusData.all_tests_passed) {
                if (statusData.feedback_questions) {
                    feedbackQuestions = parseFeedbackQuestion(statusData.feedback_questions);
                }
                // TODO: Check type properly
                courseId = (userData.getCourseByName(statusData.course) as Readonly<
                    LocalCourseData
                >).id;
            }
            temp.setContent({
                title: "TMC Server Submission",
                template: { templateName: "submission-result", statusData, feedbackQuestions },
                messageHandler,
            });
            temporaryWebviewProvider.addToRecycables(temp);
            // Check for new exercises if exercise passed.
            if (courseId) {
                checkForCourseUpdates(actionContext, courseId);
            }
            checkForExerciseUpdates(actionContext);
            break;
        }

        if (!temp.disposed) {
            temp.setContent({
                title: "TMC Server Submission",
                template: { templateName: "submission-status", statusData },
                messageHandler,
            });
        }

        await sleep(2500);
        timeWaited = timeWaited + 2500;

        if (timeWaited >= 120000 && !notified) {
            notified = true;
            showNotification(
                `This seems to be taking a long time — consider continuing to the next exercise while this is running. \
                Your submission will still be graded. Check the results later at ${submitResult.val.show_submission_url}`,
                [
                    "Open URL and move on...",
                    (): void => {
                        vscode.env.openExternal(
                            vscode.Uri.parse(submitResult.val.show_submission_url),
                        );
                        getStatus = false;
                        temp.dispose();
                    },
                ],
                ["No, I'll wait", (): void => {}],
            );
        }
    }
}

/**
 * Sends the exercise to the TMC Paste server.
 * @param id Exercise ID
 * @returns TMC Pastebin link if the action was successful.
 */
export async function pasteExercise(
    actionContext: ActionContext,
    id: number,
): Promise<string | undefined> {
    const { tmc } = actionContext;
    const params = new Map<string, string>();
    params.set("paste", "1");
    const submitResult = await tmc.submitExercise(id, params);

    const errorMessage = "Failed to send exercise to TMC pastebin.";
    if (submitResult.err) {
        Logger.error(errorMessage, submitResult.val);
        showError(errorMessage);
        return undefined;
    } else if (!submitResult.val.paste_url) {
        const notProvided = "Paste link was not provided by the server.";
        Logger.warn(errorMessage, notProvided, submitResult.val);
        showError(errorMessage + " " + notProvided);
        return undefined;
    }

    return submitResult.val.paste_url;
}

/**
 * Check for course updates.
 * @param courseId If given, check only updates for that course.
 */
export async function checkForCourseUpdates(
    actionContext: ActionContext,
    courseId?: number,
): Promise<void> {
    const { ui, userData } = actionContext;
    const courses = courseId ? [userData.getCourse(courseId)] : userData.getCourses();
    const filteredCourses = courses.filter((c) => c.notifyAfter <= Date.now());
    Logger.log(`Checking for new exercises for courses ${filteredCourses.map((c) => c.name)}`);
    const updatedCourses: LocalCourseData[] = [];
    for (const course of filteredCourses) {
        await updateCourse(actionContext, course.id);
        updatedCourses.push(userData.getCourse(course.id));
    }

    const handleDownload = async (course: LocalCourseData): Promise<void> => {
        const newIds = Array.from(course.newExercises);
        ui.webview.postMessage({
            key: `course-${course.id}-new-exercises`,
            message: {
                command: "setNewExercises",
                courseId: course.id,
                exerciseIds: [],
            },
        });
        const successful = await downloadExercises(actionContext, [
            {
                courseId: course.id,
                exerciseIds: newIds,
                organizationSlug: course.organization,
                courseName: course.name,
            },
        ]);
        await userData.clearNewExercises(course.id, successful);
        ui.webview.postMessage({
            key: `course-${course.id}-new-exercises`,
            message: {
                command: "setNewExercises",
                courseId: course.id,
                exerciseIds: course.newExercises,
            },
        });
        const openResult = await openExercises(actionContext, successful, course.name);
        if (openResult.err) {
            const message = "Failed to open new exercises.";
            Logger.error(message, openResult.val);
            showError(message);
        }
    };

    for (const course of updatedCourses) {
        if (course.newExercises.length > 0 && !course.disabled) {
            showNotification(
                `Found ${course.newExercises.length} new exercises for ${course.name}. Do you wish to download them now?`,
                ["Download", async (): Promise<void> => handleDownload(course)],
                [
                    "Remind me later",
                    (): void => {
                        userData.setNotifyDate(course.id, Date.now() + NOTIFICATION_DELAY);
                    },
                ],
            );
        }
    }
}

/**
 * Opens the TMC workspace in explorer. If a workspace is already opened, asks user first.
 */
export async function openWorkspace(actionContext: ActionContext, name: string): Promise<void> {
    const { resources, workspaceManager } = actionContext;
    const currentWorkspaceFile = vscode.workspace.workspaceFile;
    const tmcWorkspaceFile = resources.getWorkspaceFilePath(name);
    const workspaceAsUri = vscode.Uri.file(tmcWorkspaceFile);
    Logger.log(`Current workspace: ${currentWorkspaceFile?.fsPath}`);
    Logger.log(`TMC workspace: ${tmcWorkspaceFile}`);

    if (!isCorrectWorkspaceOpen(resources, name)) {
        if (
            !currentWorkspaceFile ||
            (await askForConfirmation(
                "Do you want to open TMC workspace and close the current one?",
            ))
        ) {
            if (!fs.existsSync(tmcWorkspaceFile)) {
                workspaceManager.createWorkspaceFile(name);
            }
            await vscode.commands.executeCommand("vscode.openFolder", workspaceAsUri);
            // Restarts VSCode
        } else {
            const choice = "Close current & open Course Workspace";
            await showError(
                "Please close the current workspace before opening a course workspace.",
                [
                    choice,
                    async (): Promise<Thenable<unknown>> => {
                        if (!fs.existsSync(tmcWorkspaceFile)) {
                            workspaceManager.createWorkspaceFile(name);
                        }
                        return vscode.commands.executeCommand("vscode.openFolder", workspaceAsUri);
                    },
                ],
            );
        }
    } else if (currentWorkspaceFile?.fsPath === tmcWorkspaceFile) {
        Logger.log("Workspace already open, changing focus to this workspace.");
        await vscode.commands.executeCommand("vscode.openFolder", workspaceAsUri);
        await vscode.commands.executeCommand("workbench.files.action.focusFilesExplorer");
    }
}

/**
 * Settings webview
 */
export async function openSettings(actionContext: ActionContext): Promise<void> {
    const { ui, resources, settings } = actionContext;
    Logger.log("Display extension settings");
    const extensionSettings = await settings.getExtensionSettings();
    if (extensionSettings.err) {
        const message = "Failed to fetch Settings.";
        Logger.error(message, extensionSettings.val);
        showError(message);
        return;
    }
    ui.webview.setContentFromTemplate(
        {
            templateName: "settings",
            extensionSettings: extensionSettings.val,
            tmcDataSize: formatSizeInBytes(await du(resources.getDataPath())),
        },
        true,
    );
}

interface NewCourseOptions {
    organization?: string;
    course?: number;
}
/**
 * Adds a new course to user's courses.
 */
export async function addNewCourse(
    actionContext: ActionContext,
    options?: NewCourseOptions,
): Promise<Result<void, Error>> {
    const { tmc, userData, workspaceManager } = actionContext;
    Logger.log("Adding new course");
    let organization = options?.organization;
    let course = options?.course;

    if (!organization || !course) {
        const orgAndCourse = await selectOrganizationAndCourse(actionContext);
        if (orgAndCourse.err) {
            return orgAndCourse;
        }
        organization = orgAndCourse.val.organization;
        course = orgAndCourse.val.course;
    }

    const courseDetailsResult = await tmc.getCourseDetails(course);
    const courseExercisesResult = await tmc.getCourseExercises(course);
    const courseSettingsResult = await tmc.getCourseSettings(course);
    if (courseDetailsResult.err) {
        return courseDetailsResult;
    }
    if (courseExercisesResult.err) {
        return courseExercisesResult;
    }
    if (courseSettingsResult.err) {
        return courseSettingsResult;
    }

    const courseDetails = courseDetailsResult.val.course;
    const courseExercises = courseExercisesResult.val;
    const courseSettings = courseSettingsResult.val;

    let availablePoints = 0;
    let awardedPoints = 0;
    courseExercises.forEach((x) => {
        availablePoints += x.available_points.length;
        awardedPoints += x.awarded_points.length;
    });

    const localData: LocalCourseData = {
        description: courseDetails.description || "",
        exercises: courseDetails.exercises.map((e) => ({
            id: e.id,
            name: e.name,
            passed: e.completed,
        })),
        id: courseDetails.id,
        name: courseDetails.name,
        title: courseDetails.title,
        organization: organization,
        availablePoints: availablePoints,
        awardedPoints: awardedPoints,
        perhapsExamMode: courseSettings.hide_submission_results,
        newExercises: [],
        notifyAfter: 0,
        disabled: courseSettings.disabled_status === "enabled" ? false : true,
        material_url: courseSettings.material_url,
    };
    userData.addCourse(localData);
    workspaceManager.createWorkspaceFile(courseDetails.name);
    await displayUserCourses(actionContext);
    return Ok.EMPTY;
}

/**
 * Removes given course from UserData and closes all its exercises.
 * @param id ID of the course to remove
 */
export async function removeCourse(actionContext: ActionContext, id: number): Promise<void> {
    const { userData, workspaceManager, resources } = actionContext;
    const course = userData.getCourse(id);
    Logger.log(`Closing exercises for ${course.name} and removing course data from userData`);
    const closeResult = await closeExercises(
        actionContext,
        course.exercises.map((e) => e.id),
        course.name,
    );
    if (closeResult.err) {
        const message = "Failed to close exercises while removing course.";
        Logger.error(message, closeResult.val);
        showError(message);
    }
    const exercises = workspaceManager.getExercisesByCourseName(course.name);
    const missingIds = exercises
        .filter((e) => e.status === ExerciseStatus.MISSING)
        .map((e) => e.id);
    Logger.log(`Removing ${missingIds.length} exercise data with Missing status`);
    workspaceManager.deleteExercise(...missingIds);
    delSync(path.join(resources.getWorkspaceFolderPath(), course.name, ".code-workspace"), {
        force: true,
    });
    userData.deleteCourse(id);
}

/**
 * Updates the given course by re-fetching all data from the server. Handles authorization and
 * connection errors as successful operations where the data was not actually updated.
 *
 * @param courseId ID of the course to update.
 * @returns Boolean value representing whether the data from server was succesfully received.
 */
export async function updateCourse(
    actionContext: ActionContext,
    courseId: number,
): Promise<Result<boolean, Error>> {
    const { tmc, ui, userData, workspaceManager } = actionContext;
    const postMessage = (courseId: number, disabled: boolean, exerciseIds: number[]): void => {
        Logger.debug("Post message updatecourse", courseId, disabled, ...exerciseIds);
        ui.webview.postMessage(
            {
                key: `course-${courseId}-new-exercises`,
                message: {
                    command: "setNewExercises",
                    courseId,
                    exerciseIds,
                },
            },
            {
                key: `course-${courseId}-disabled-notification`,
                message: {
                    command: "setCourseDisabledStatus",
                    courseId,
                    disabled,
                },
            },
        );
    };
    const courseData = userData.getCourse(courseId);
    const updateResult = Result.all(
        ...(await Promise.all([
            tmc.getCourseDetails(courseId),
            tmc.getCourseExercises(courseId),
            tmc.getCourseSettings(courseId),
        ])),
    );
    if (updateResult.err) {
        if (updateResult.val instanceof AuthorizationError) {
            if (!courseData.disabled) {
                Logger.warn(
                    `Failed to access information for course ${courseData.name}. Marking as disabled.`,
                );
                const course = userData.getCourse(courseId);
                await userData.updateCourse({ ...course, disabled: true });
                postMessage(course.id, true, []);
            } else {
                Logger.warn(`Course is still disabled ${courseData.name}`);
                postMessage(courseData.id, true, []);
            }
            return Ok(false);
        } else if (updateResult.val instanceof ConnectionError) {
            Logger.warn("Failed to fetch data from TMC servers, data not updated.");
            return Ok(false);
        } else {
            return updateResult;
        }
    }

    const [details, exercises, settings] = updateResult.val;
    const [availablePoints, awardedPoints] = exercises.reduce(
        (a, b) => [a[0] + b.available_points.length, a[1] + b.awarded_points.length],
        [0, 0],
    );

    await userData.updateCourse({
        ...courseData,
        availablePoints,
        awardedPoints,
        description: details.course.description || "",
        disabled: settings.disabled_status !== "enabled",
        material_url: settings.material_url,
        perhapsExamMode: settings.hide_submission_results,
    });

    const updateExercisesResult = await userData.updateExercises(
        courseId,
        details.course.exercises.map((x) => ({ id: x.id, name: x.name, passed: x.completed })),
    );
    if (updateExercisesResult.err) {
        return updateExercisesResult;
    }

    exercises.forEach((ex) => {
        workspaceManager.updateExerciseData(ex.id, ex.soft_deadline, ex.deadline);
    });

    const course = userData.getCourse(courseId);
    postMessage(course.id, course.disabled, course.newExercises);

    return Ok(true);
}
