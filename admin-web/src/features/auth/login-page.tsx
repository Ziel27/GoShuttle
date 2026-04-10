import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FiLock, FiMail, FiShield } from 'react-icons/fi';
import { z } from 'zod';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/auth-context';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type LoginForm = z.infer<typeof schema>;

export const LoginPage = () => {
  const { login } = useAuth();
  const [error, setError] = useState('');
  const { register, handleSubmit, formState } = useForm<LoginForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError('');
    try {
      await login(values.email.trim().toLowerCase(), values.password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to login.');
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8">
      <div className="w-full max-w-md">
        <Card className="w-full border-slate-200 bg-white shadow-sm">
          <CardHeader className="space-y-4">
            <div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <FiShield className="h-5 w-5" />
            </div>
            <div className="space-y-1 text-center">
              <CardTitle className="text-2xl font-semibold">GoShuttle Admin</CardTitle>
              <CardDescription className="mx-auto max-w-sm">
                Secure operations dashboard. Admin account required.
              </CardDescription>
              <p className="text-xs text-slate-500">No public signup on admin portal.</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {error ? (
              <Alert variant="destructive" aria-live="polite">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <form className="space-y-4" onSubmit={onSubmit} noValidate>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <FiMail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input id="email" type="email" className="pl-10" {...register('email')} />
                </div>
                {formState.errors.email ? (
                  <p className="text-xs text-destructive">{formState.errors.email.message}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <FiLock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input id="password" type="password" className="pl-10" {...register('password')} />
                </div>
                {formState.errors.password ? (
                  <p className="text-xs text-destructive">{formState.errors.password.message}</p>
                ) : null}
              </div>

              <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
                {formState.isSubmitting ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
