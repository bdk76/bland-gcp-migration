const { LanguageServiceClient } = require('@google-cloud/language');

const mockAnalyzeEntities = jest.fn();

jest.mock('@google-cloud/language', () => ({
  LanguageServiceClient: jest.fn().mockImplementation(() => ({
    analyzeEntities: mockAnalyzeEntities,
  })),
}));

describe('cleanEmail', () => {
  let cleanEmail;

  beforeEach(() => {
    jest.resetModules();
    cleanEmail = require('./index').cleanEmail;
    mockAnalyzeEntities.mockClear();
    mockAnalyzeEntities.mockResolvedValue([{ entities: [] }]);
  });

  it('should return a string', async () => {
    const email = 'test@example.com';
    const cleanedEmail = await cleanEmail(email);
    expect(typeof cleanedEmail).toBe('string');
  });

  it('should handle basic cleaning', async () => {
    const email = ' test at example dot com ';
    const cleanedEmail = await cleanEmail(email);
    expect(cleanedEmail).toBe('test@example.com');
  });

  it('should correct common domain misspellings', async () => {
    const email1 = 'test@gmailcom';
    const email2 = 'test@yahoodotco';
    const email3 = 'test@outlookdot';
    const cleanedEmail1 = await cleanEmail(email1);
    const cleanedEmail2 = await cleanEmail(email2);
    const cleanedEmail3 = await cleanEmail(email3);
    expect(cleanedEmail1).toBe('test@gmail.com');
    expect(cleanedEmail2).toBe('test@yahoo.com');
    expect(cleanedEmail3).toBe('test@outlook.com');
  });

  it('should use the email from Natural Language API if available', async () => {
    mockAnalyzeEntities.mockResolvedValueOnce([
      {
        entities: [
          {
            type: 'EMAIL',
            name: 'test@example.com',
          },
        ],
      },
    ]);

    const email = 'my email is test at example dot com';
    const cleanedEmail = await cleanEmail(email);
    expect(cleanedEmail).toBe('test@example.com');
  });
});

describe('Email cleaning edge cases', () => {
  let cleanEmail;

  beforeEach(() => {
    jest.resetModules();
    cleanEmail = require('./index').cleanEmail;
    mockAnalyzeEntities.mockClear();
    mockAnalyzeEntities.mockResolvedValue([{ entities: [] }]);
  });

  const testCases = [
    ['tst@example.com', 'tst@example.com', 'Misspelling in name'],
    ['testuser@examplecom', 'testuser@example.com', 'Domain misspelling'],
    ['test user@example.com', 'testuser@example.com', 'Space in name'],
    ['test.user@example.com', 'test.user@example.com', 'Dot in name'],
    ['test_user@example.com', 'test_user@example.com', 'Underscore in name'],
    ['test-user@example.com', 'test-user@example.com', 'Hyphen in name'],
    ['test+user@example.com', 'test+user@example.com', 'Plus in name'],
    ['"test user"@example.com', '"testuser"@example.com', 'Quoted string in name'],
    ['test@.com', 'test@.com', 'Missing domain name'],
    ['@example.com', '@example.com', 'Missing local part'],
    ['test@example..com', 'test@example.com', 'Double dot in domain'],
    ['test.@example.com', 'test.@example.com', 'Dot at the end of local part'],
    ['.test@example.com', '.test@example.com', 'Dot at the beginning of local part'],
    ['test@example.c', 'test@example.c', 'Invalid TLD'],
    ['test@123.45.67.89', 'test@123.45.67.89', 'IP address as domain'],
    ['test@localhost', 'test@localhost', 'Localhost as domain'],
    ['test@gail.com', 'test@gail.com', 'Misspelled gmail'],
    ['test@yaho.com', 'test@yaho.com', 'Misspelled yahoo'],
    ['test@hotmale.com', 'test@hotmale.com', 'Misspelled hotmail'],
    ['test@outlok.com', 'test@outlok.com', 'Misspelled outlook'],
    ['test@icloudcom', 'test@icloud.com', 'iCloud with no dot'],
  ];

  it.each(testCases)('should handle: %s', async (input, expected, description) => {
    const cleanedEmail = await cleanEmail(input);
    expect(cleanedEmail).toBe(expected);
  });
});