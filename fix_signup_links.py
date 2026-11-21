import pathlib, re
root = pathlib.Path(r"D:\Danish\Projects\verafo-web\public")
count = 0
for p in sorted(root.glob("*.html")):
    s = p.read_text(encoding="utf-8")
    before = s
    # Every "Sign up" in the nav and footer is a merchant who wants an account:
    # accounts are created by installing the Shopify app, so send them there.
    s = s.replace('<a class="btn btn--primary btn--sm" href="https://www.verafo.com/login">Sign up</a>',
                  '<a class="btn btn--primary btn--sm" href="https://apps.shopify.com/verafo">Sign up</a>')
    s = s.replace('<a class="btn btn--primary" href="https://www.verafo.com/login">Sign up</a>',
                  '<a class="btn btn--primary" href="https://apps.shopify.com/verafo">Sign up</a>')
    if s != before:
        p.write_text(s, encoding="utf-8")
        count += 1
        print("updated", p.name)
print("files updated:", count)
left = [ (p.name, i+1) for p in root.glob("*.html") for i, l in enumerate(p.read_text(encoding="utf-8").splitlines()) if "verafo.com/login" in l and "Sign up" in l ]
print("Sign up still on /login:", left)
