import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';

// The existing primitives as they are (S0 "before"); later stages restyle them.
const meta: Meta = { title: '基本部品/現在の部品', parameters: { layout: 'padded' } };
export default meta;

export const Buttons: StoryObj = {
  name: 'ボタン',
  render: () => (
    <div className="flex flex-wrap gap-3">
      {(['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const).map((variant) => (
        <Button key={variant} variant={variant}>{variant}</Button>
      ))}
      <Button disabled>無効</Button>
    </div>
  ),
};

export const Badges: StoryObj = {
  name: '状態の表示',
  render: () => (
    <div className="flex flex-wrap gap-3">
      {(['default', 'secondary', 'outline', 'destructive'] as const).map((variant) => (
        <Badge key={variant} variant={variant}>{variant}</Badge>
      ))}
    </div>
  ),
};

export const FormAndCard: StoryObj = {
  name: '入力とカード',
  render: () => (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>カードの見出し</CardTitle>
        <CardDescription>補足の説明文です。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label htmlFor="sample">氏名</Label>
        <Input id="sample" placeholder="合成職員A" />
      </CardContent>
    </Card>
  ),
};
