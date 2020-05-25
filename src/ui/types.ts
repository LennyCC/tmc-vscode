import TMC from "../api/tmc";
import Storage from "../config/storage";
import UI from "./ui";
import { ExtensionSettings, LocalCourseData } from "../config/types";
import { Course, Organization, SubmissionStatusReport } from "../api/types";
import { FeedbackQuestion } from "../actions/types";

export type HandlerContext = {
    tmc: TMC;
    storage: Storage;
    ui: UI;
    visibilityGroups: VisibilityGroups;
};

export type VisibilityGroups = {
    LOGGED_IN: VisibilityGroup;
    WORKSPACE_OPEN: VisibilityGroup;
};

export type VisibilityGroup = {
    _id: string;
    not: VisibilityGroupNegated;
};

export type VisibilityGroupNegated = {
    _id: string;
};

export type TemplateData =
    | ({ templateName: "course-details" } & CourseDetailsData)
    | ({ templateName: "course" } & CourseData)
    | ({ templateName: "download-exercises" } & DownloadExercisesData)
    | ({ templateName: "downloading-exercises" } & DownloadingExercisesData)
    | ({ templateName: "error" } & ErrorData)
    | ({ templateName: "index" } & IndexData)
    | { templateName: "loading" }
    | ({ templateName: "login" } & loginData)
    | ({ templateName: "organization" } & OrganizationData)
    | ({ templateName: "running-tests" } & RunningTestsData)
    | ({ templateName: "settings" } & SettingsData)
    | ({ templateName: "submission-result" } & SubmissionResultData)
    | ({ templateName: "submission-status" } & SubmissionStatusData)
    | ({ templateName: "test-result" } & TestResultData);

export type CourseDetailsData = {
    course: LocalCourseData;
    courseId: number;
    exerciseData: CourseDetailsExercise[];
};

export type CourseDetailsExercise = {
    id: number;
    name: string;
    isOpen: boolean;
    isClosed: boolean;
    passed: boolean;
    deadlineString: string;
    hardDeadlineString: string;
    isHard: boolean;
};

export type CourseData = {
    courses: Course[];
    organization: Organization;
};

export type DownloadExercisesData = {
    courseId: number;
    courseName: string;
    details: unknown;
    organizationSlug: string;
    exerciseLists: unknown;
};

export type DownloadingExercisesData = {
    returnToCourse?: number;
    exercises: DownloadingExercisesExercise[];
    failed: number;
    failedPct: number;
    remaining: number;
    successful: number;
    successfulPct: number;
    total: number;
};

export type DownloadingExercisesExercise = {
    name: string;
    organizationSlug: string;
    downloaded: boolean;
    failed: boolean;
    error: string;
    status: string;
};

export type ErrorData = {
    error: Error;
};

export type IndexData = {
    courses: Array<LocalCourseData & { completedPrc: string }>;
};

export type loginData = {
    error?: string;
};

export type OrganizationData = {
    organizations: Organization[];
    pinned: Organization[];
};

export type RunningTestsData = {
    exerciseName: string;
};

export type SettingsData = {
    extensionSettings: ExtensionSettings;
    tmcDataSize: string;
};

export type SubmissionResultData = {
    statusData: SubmissionStatusReport;
    feedbackQuestions: FeedbackQuestion[];
};

export type SubmissionStatusData = {
    statusData: SubmissionStatusReport;
};

export type TestResultData = {
    testResult: unknown;
    id: number;
    exerciseName: string;
    tmcLogs: {
        stdout?: string;
        stderr?: string;
    };
    pasteLink?: string;
};