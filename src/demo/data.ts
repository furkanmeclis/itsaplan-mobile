import type { Account } from '../domain/accounts';

export interface DemoTask {
  id: number;
  identifier: string;
  project: string;
  title: string;
  description: string;
  state: 'Yapılacak' | 'Devam ediyor' | 'Tamamlandı';
  comments: string[];
}

export interface DemoNotification {
  id: number;
  taskId: number;
  text: string;
}

export interface DemoAccountData {
  tasks: DemoTask[];
  notifications: DemoNotification[];
  notificationsEnabled: boolean;
}

export const demoAccounts: Account[] = [
  { server: 'https://studio.example', userId: 'demo-user', label: 'Stüdyo · Deniz' },
  { server: 'https://collective.example', userId: 'demo-user', label: 'Kolektif · Deniz' },
];

export function createDemoData(): DemoAccountData[] {
  return [
    {
      tasks: [
        { id: 1, identifier: 'ST-12', project: 'Mobil deneyim', title: 'Yeni güne sakin bir başlangıç', description: 'Günlük görev görünümünü ekip ile gözden geçir. Bu içerik yalnızca etkileşimli demo için hazırlanmıştır.', state: 'Devam ediyor', comments: ['Ortak renk değerlerini kullanalım.'] },
        { id: 2, identifier: 'ST-18', project: 'Mobil deneyim', title: 'Bildirim metinlerini gözden geçir', description: 'Kaynak hesabı her bildirimde görünür tut.', state: 'Yapılacak', comments: [] },
      ],
      notifications: [{ id: 1, taskId: 1, text: 'Sana bir görev atandı' }],
      notificationsEnabled: true,
    },
    {
      tasks: [{ id: 1, identifier: 'KL-12', project: 'Topluluk', title: 'Topluluk buluşmasını hazırla', description: 'Bu görev farklı bir sunucuya aittir. Aynı uzak ID, farklı hesap kapsamında saklanır.', state: 'Yapılacak', comments: ['Gündem taslağı hazır.'] }],
      notifications: [{ id: 1, taskId: 1, text: 'Takip ettiğin göreve yorum yapıldı' }],
      notificationsEnabled: false,
    },
  ];
}
