/**
 * What importing `assemora` does until there is a release to import.
 *
 * It throws rather than exporting a no-op `assemora()`. A stub that returns something
 * lets an application boot and fail later, somewhere with no connection to the reason;
 * this fails at the import, where the message can name it.
 */
throw new Error(
  'The assemora package is not released yet. It runs from a checkout today: ' +
    'https://github.com/assemora/assemora',
)
