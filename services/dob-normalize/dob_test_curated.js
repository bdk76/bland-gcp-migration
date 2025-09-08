
const moment = require('moment');

// Correctly import the function from the main application file.
delete require.cache[require.resolve('./index.js')];
const { normalizeDateOfBirth } = require('./index.js');

// --- Curated Test Suite (Top 25 Most Likely Cases) ---
const testCases = [
    // Common numeric formats
    { input: "1/1/1990", expected: "1990-01-01" },
    { input: "01-01-1990", expected: "1990-01-01" },
    { input: "1990-01-01", expected: "1990-01-01" },
    { input: "3/15/2005", expected: "2005-03-15" },
    { input: "2005/03/15", expected: "2005-03-15" },
    { input: "2/2/68", expected: "1968-02-02" },
    { input: "11/12/12", expected: "2012-11-12" },
    { input: "1/13/2021", expected: "2021-01-13" },

    // Simple month name formats
    { input: "January 1, 1990", expected: "1990-01-01" },
    { input: "jan 1 1990", expected: "1990-01-01" },
    { input: "March 15, 2005", expected: "2005-03-15" },
    { input: "mar 15 05", expected: "2005-03-15" },
    { input: "15 mar 2005", expected: "2005-03-15" },
    { input: "june 1, 99", expected: "1999-06-01" },
    { input: "Feb 29, 2024", expected: "2024-02-29" },
    { input: "july 4, 1995", expected: "1995-07-04" },

    // Simple spoken day formats
    { input: "January first, 1990", expected: "1990-01-01" },
    { input: "March fifteenth, 2005", expected: "2005-03-15" },
    { input: "July fourth, 1995", expected: "1995-07-04" },
    { input: "September twenty-second, 1999", expected: "1999-09-22" },

    // Invalid day/month combinations
    { input: "Feb 29, 2023", expected: null },
    { input: "November 31, 2021", expected: null },

    // Invalid inputs
    { input: "hello world", expected: null },
    { input: "tomorrow", expected: null },
    { input: "", expected: null },
];

// --- Test Runner ---
async function runTests() {
    let successes = 0;
    let failures = 0;
    const failureReports = [];

    for (const [index, test] of testCases.entries()) {
        try {
            const actual = await normalizeDateOfBirth(test.input);
            if (actual === test.expected) {
                successes++;
            } else {
                failures++;
                failureReports.push({
                    testCase: index + 1,
                    input: test.input,
                    expected: test.expected,
                    actual: actual
                });
            }
        } catch (e) {
            failures++;
            failureReports.push({
                testCase: index + 1,
                input: test.input,
                expected: test.expected,
                actual: `ERROR: ${e.message}`
            });
        }
    }

    const successRate = (successes / testCases.length) * 100;

    console.log(`--- Curated Test Report ---`);
    console.log(`Total Test Cases: ${testCases.length}`);
    console.log(`Successes: ${successes}`);
    console.log(`Failures: ${failures}`);
    console.log(`Success Rate: ${successRate.toFixed(2)}%`);
    console.log(`-------------------`);

    if (failures > 0) {
        console.log('\n--- Failure Details ---');
        failureReports.forEach(report => {
            console.log(`Test Case #${report.testCase}`);
            console.log(`  Input:    '${report.input}'`);
            console.log(`  Expected: '${report.expected}'`);
            console.log(`  Actual:   '${report.actual}'`);
            console.log(`-----------------------`);
        });
    }
}

runTests();
