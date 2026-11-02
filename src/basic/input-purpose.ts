// What a TextBox's text is for, as the browser understands it (WPF has no
// equivalent; HTML's autocomplete tokens). Read only when the TextBox uses a
// native input (TextBox.UsesNativeInput): it sets the input's autocomplete
// token, type and on-screen keyboard, which is how password managers and
// mobile keyboards recognise a sign-in form. Markup: `InputPurpose = Email`.
export enum InputPurpose
{
    None            = 'None',
    Email           = 'Email',
    Username        = 'Username',
    CurrentPassword = 'CurrentPassword',
    NewPassword     = 'NewPassword',
    OneTimeCode     = 'OneTimeCode',
}
