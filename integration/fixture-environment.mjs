const operatorVariables = ['ITSAPLAN_API_URL', 'ITSAPLAN_API_KEY', 'APNS_KEY_FILE', 'FCM_SERVICE_ACCOUNT_FILE', 'GOOGLE_SERVICES_FILE'];
const serviceVariables = ['DATABASE_URL', 'API_URL', 'APP_URL', 'BETTER_AUTH_SECRET', 'APP_ENCRYPTION_KEY',
  'MOBILE_ENCRYPTION_KEY', 'MOBILE_GATEWAY_KEY', 'MOBILE_GATEWAY_URL', 'GATEWAY_DATABASE_URL', 'GATEWAY_ENCRYPTION_KEY'];

export function fixtureEnvironment(environment) {
  const result = { ...environment };
  for (const name of [...operatorVariables, ...serviceVariables]) delete result[name];
  return result;
}

export function assertNoOperatorCredentials(environment) {
  if (operatorVariables.some((name) => environment[name] !== undefined)) throw new Error('Operator credentials are not allowed in disposable fixtures');
}
