import { expect } from "chai";

import Storage, {
    ExerciseStatus,
    ExtensionSettings,
    LocalExerciseData,
    SessionState,
    UserData,
} from "../../api/storage";
import { createMockContext } from "../__mocks__/vscode";

suite("Storage class", function () {
    const exerciseData: LocalExerciseData[] = [
        {
            id: 0,
            course: "test-python-course",
            name: "hello_world",
            path: "/path/to/exercise",
            status: ExerciseStatus.OPEN,
        },
    ];

    const extensionSettings: ExtensionSettings = {
        dataPath: "/path/to/exercises",
        downloadOldSubmission: true,
        hideMetaFiles: true,
        insiderVersion: false,
        logLevel: "verbose",
        updateExercisesAutomatically: true,
    };

    const sessionState: SessionState = {
        extensionVersion: "2.0.0",
        oldDataPath: { path: "/path/to/exercises", timestamp: 1234 },
    };

    const userData: UserData = {
        courses: [
            {
                id: 0,
                availablePoints: 3,
                awardedPoints: 0,
                description: "Python Course",
                disabled: true,
                exercises: [
                    {
                        id: 1,
                        deadline: null,
                        name: "hello_world",
                        passed: false,
                        softDeadline: null,
                    },
                    {
                        id: 2,
                        deadline: "20201214",
                        name: "other_hello_world",
                        passed: false,
                        softDeadline: "20201212",
                    },
                ],
                materialUrl: "mooc.fi",
                name: "test-python-course",
                newExercises: [2, 3, 4],
                notifyAfter: 1234,
                organization: "test",
                perhapsExamMode: true,
                title: "The Python Course",
            },
        ],
    };

    let storage: Storage;

    setup(function () {
        storage = new Storage(createMockContext());
    });

    test("should store and retrieve exercise data", async function () {
        expect(storage.getExerciseData()).to.be.undefined;
        await storage.updateExerciseData(exerciseData);
        expect(storage.getExerciseData()).to.be.deep.equal(exerciseData);
    });

    test("should store and retrieve extension settings", async function () {
        expect(storage.getExtensionSettings()).to.be.undefined;
        await storage.updateExtensionSettings(extensionSettings);
        expect(storage.getExtensionSettings()).to.be.deep.equal(extensionSettings);
    });

    test("should store and retrieve session state", async function () {
        expect(storage.getSessionState()).to.be.undefined;
        await storage.updateSessionState(sessionState);
        expect(storage.getSessionState()).to.be.deep.equal(sessionState);
    });

    test("should store and retrieve user data", async function () {
        expect(storage.getUserData()).to.be.undefined;
        await storage.updateUserData(userData);
        expect(storage.getUserData()).to.be.deep.equal(userData);
    });

    test("should use unique key for exercise data", async function () {
        await storage.updateExerciseData(exerciseData);
        expect(storage.getExtensionSettings()).to.be.undefined;
        expect(storage.getSessionState()).to.be.undefined;
        expect(storage.getUserData()).to.be.undefined;
    });

    test("should use unique key for extension settings", async function () {
        await storage.updateExtensionSettings(extensionSettings);
        expect(storage.getExerciseData()).to.be.undefined;
        expect(storage.getSessionState()).to.be.undefined;
        expect(storage.getUserData()).to.be.undefined;
    });

    test("should use unique key for session state", async function () {
        await storage.updateSessionState(sessionState);
        expect(storage.getExerciseData()).to.be.undefined;
        expect(storage.getExtensionSettings()).to.be.undefined;
        expect(storage.getUserData()).to.be.undefined;
    });

    test("should use unique key for user data", async function () {
        await storage.updateUserData(userData);
        expect(storage.getExerciseData()).to.be.undefined;
        expect(storage.getExtensionSettings()).to.be.undefined;
        expect(storage.getSessionState()).to.be.undefined;
    });

    test("should wipe all data", async function () {
        await storage.updateExerciseData(exerciseData);
        await storage.updateExtensionSettings(extensionSettings);
        await storage.updateSessionState(sessionState);
        await storage.updateUserData(userData);
        await storage.wipeStorage();
        expect(storage.getExerciseData()).to.be.undefined;
        expect(storage.getExtensionSettings()).to.be.undefined;
        expect(storage.getSessionState()).to.be.undefined;
        expect(storage.getUserData()).to.be.undefined;
    });
});
