import { fetch } from 'expo/fetch';
import { PlannerClient } from './client';

export const plannerClient = new PlannerClient(async (url, init) => fetch(url, init) as Promise<Response>);
