const moment = require('moment');

// --- Cache Clearing ---
// This is the critical line that ensures we load the most recent version of index.js
delete require.cache[require.resolve('./index.js')];

// Correctly import the function from the main application file.
const { normalizeDateOfBirth } = require('./index.js');

// --- Test Suite ---
const testCases = [
    // Common formats
    { input: "January 1st, 1990", expected: "1990-01-01" },
    { input: "jan 1 1990", expected: "1990-01-01" },
    { input: "1/1/1990", expected: "1990-01-01" },
    { input: "01-01-1990", expected: "1990-01-01" },
    { input: "1990-01-01", expected: "1990-01-01" },
    { input: "March 15, 2005", expected: "2005-03-15" },
    { input: "mar 15 05", expected: "2005-03-15" },
    { input: "15 mar 2005", expected: "2005-03-15" },
    { input: "2005/03/15", expected: "2005-03-15" },

    // Spoken dates
    { input: "may fifth two thousand and one", expected: "2001-05-05" },
    { input: "the third of august nineteen eighty five", expected: "1985-08-03" },
    { input: "september twenty-second, 1999", expected: "1999-09-22" },
    { input: "december thirty-first two thousand twenty three", expected: "2023-12-31" },
    { input: "February tenth, nineteen sixty", expected: "1960-02-10" },

    // 2-digit year ambiguity
    { input: "2/2/68", expected: "1968-02-02" },
    { input: "11/12/12", expected: "2012-11-12" },
    { input: "may second, oh five", expected: "2005-05-02" },
    { input: "june 1st, 99", expected: "1999-06-01" },

    // Edge cases
    { input: "February 29th, 2024", expected: "2024-02-29" }, // Leap year
    { input: "Feb 29, 2023", expected: null }, // Not a leap year
    { input: "November 31st, 2021", expected: null }, // Invalid day for month
    { input: "13/1/2021", expected: null }, // Ambiguous MM/DD vs DD/MM
    { input: "1/13/2021", expected: "2021-01-13" },

    // Messy input
    { input: "  july 4th, 1995 ", expected: "1995-07-04" },
    { input: "july.4.1995", expected: "1995-07-04" },
    { input: "1995, july 4", expected: "1995-07-04" },

    // Invalid inputs
    { input: "hello world", expected: null },
    { input: "January", expected: null },
    { input: "1990", expected: null },
    { input: "the first of the month", expected: null },
    { input: "tomorrow", expected: null },
    { input: "", expected: null },
    { input: null, expected: null },
    { input: undefined, expected: null },

    // More spoken variations
    { input: "October twenty ten", expected: "2010-10-20" },
    { input: "october twenty, twenty ten", expected: "2010-10-20" },
    { input: "the first of jan, ninety", expected: "1990-01-01" },
    { input: "the second of feb nineteen ninety one", expected: "1991-02-02" },
    { input: "the third of mar nineteen ninety two", expected: "1992-03-03" },
    { input: "the fourth of apr nineteen ninety three", expected: "1993-04-04" },
    { input: "the fifth of may nineteen ninety four", expected: "1994-05-05" },
    { input: "the sixth of jun nineteen ninety five", expected: "1995-06-06" },
    { input: "the seventh of jul nineteen ninety six", expected: "1996-07-07" },
    { input: "the eighth of aug nineteen ninety seven", expected: "1997-08-08" },
    { input: "the ninth of sep nineteen ninety eight", expected: "1998-09-09" },
    { input: "the tenth of oct nineteen ninety nine", expected: "1999-10-10" },
    { input: "the eleventh of nov two thousand", expected: "2000-11-11" },
    { input: "the twelfth of dec two thousand and one", expected: "2001-12-12" },
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

    console.log(`--- Test Report ---`);
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