import * as TypeMoq from "typemoq";
import * as vscode from "vscode";

import Storage, { ExtensionSettings } from "../../api/storage";
import { ExerciseStatus, LocalExerciseDataV1 } from "../../api/storageSchema";
import { LogLevel } from "../../utils";

// TODO: Redo after migration
suite.skip("Storage tests", () => {
    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    let mockMemento: TypeMoq.IMock<vscode.Memento>;
    let storage: Storage;

    setup(() => {
        mockMemento = TypeMoq.Mock.ofType<vscode.Memento>();
        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        mockContext.setup((x) => x.globalState).returns(() => mockMemento.object);
        storage = new Storage(mockContext.object);
    });

    // Same as hardcoded keys in Storage class. We "magically" know them also here to remind you
    // that changing these may break compatibility between releases.
    const EXERCISE_DATA_KEY = "exerciseData";
    const EXTENSION_SETTINGS_KEY = "extensionSettings";

    /**
     * Helper function for running similar mock tests to multiple storage's updaters.
     * @param updater Storage method for updating some data
     * @param hardcodedKey Hardcoded key used internally within the Storage object
     * @param checkForValue Value that was stored with updater
     */
    function assertUpdater<T>(updater: () => void, hardcodedKey: string, checkForValue: T): void {
        mockMemento.verify(
            (x) => x.update(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.never(),
        );
        updater();
        mockMemento.verify(
            (x) => x.update(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
        mockMemento.verify(
            (x) => x.update(TypeMoq.It.isValue(hardcodedKey), TypeMoq.It.isValue(checkForValue)),
            TypeMoq.Times.once(),
        );
    }

    /**
     * Helper function for running similar mock tests to multiple storage's getters.
     * @param getter Storage method for getting some data
     * @param hardcodedKey Hardcoded key used internally within the Storage object
     */
    function assertGetter<T>(getter: () => T, hardcodedKey: string): void {
        mockMemento.verify((x) => x.get(TypeMoq.It.isAny()), TypeMoq.Times.never());
        getter();
        mockMemento.verify((x) => x.get(TypeMoq.It.isAny()), TypeMoq.Times.once());
        mockMemento.verify((x) => x.get(TypeMoq.It.isValue(hardcodedKey)), TypeMoq.Times.once());
    }

    // TODO: Update test suite to use new version of storage.
    test.skip("Exercise data updater uses ExtensionContext correctly", () => {
        const exerciseData: LocalExerciseDataV1[] = [
            {
                // checksum: "asd",
                course: "HY-jtkt",
                // deadline: "2020-03-21",
                // softDeadline: "2020-03-19",
                id: 1337,
                path: "HY-jtkt/hello-world",
                status: ExerciseStatus.CLOSED,
                name: "hello-world",
                // organization: "HY",
            },
        ];
        assertUpdater(
            () => storage.updateExerciseData(exerciseData),
            EXERCISE_DATA_KEY,
            exerciseData,
        );
    });

    test("Exercise data getter uses ExtensionContext correctly", () => {
        assertGetter(() => storage.getExerciseData({ version: 0 }), EXERCISE_DATA_KEY);
    });

    test("Extension settings updater uses ExtensionContext correctly", () => {
        const extensionSettings: ExtensionSettings = {
            insiderVersion: false,
            dataPath: "/tmp/tmcdata",
            oldDataPath: undefined,
            logLevel: LogLevel.None,
            hideMetaFiles: true,
            downloadOldSubmission: true,
            updateExercisesAutomatically: true,
        };
        assertUpdater(
            () => storage.updateExtensionSettings(extensionSettings),
            EXTENSION_SETTINGS_KEY,
            extensionSettings,
        );
    });

    test("Extension settings getter uses ExtensionContext correctly", () => {
        assertGetter(() => storage.getExtensionSettings(), EXTENSION_SETTINGS_KEY);
    });
});
